import * as THREE from 'three';
import { scene, arenaRadius } from './scene.js';
import { ONE_SHOT, ATTACKS } from './combat.js';
import { BLOCK_ANIM } from './classes.js';
import { activeDifficulty } from './difficulty.js';
import { getFloorY } from './scene.js';
import { playAttackSwingSound } from './sfx.js';

// Maps logical animation names → actual GLB clip names (Fantacode Melee Combat System)
const ANIM_MAP = {
  'Idle_Loop':       'Combat Idle',
  'Walk_Loop':       'Combat Walk Fwd',
  'Walk_Back_Loop':  'Combat Walk Bwd',
  'Sprint_Loop':     'Combat Walk Fwd',
  'Jab':             'Left Jab',
  'Hook':            'Left Hook',
  'Hook_Right':      'Right Hook',
  'Cross':           'Right Cross',
  'Uppercut':        'Uppercut',
  'Uppercut_Combo':  'Uppercut Combo',
  'Body_Punch':      'Right Body Punch',
  'Body_Punch_L':    'Left Body Punch',
  'Kick_Front':      'Flying Kick',
  'Kick_Round':      'Round Kick',
  'Kick_MMA':        'Mma Kick Reverse',
  'Kick_Side':       'Step Side Kick',
  'Elbow':           'Right Overhand',
  'Tackle':          'Leg Trip Counter',
  'Sweep':           'SWEEP_1ST_CHAR',
  'Block_Loop':      'Block',
  'Roll':            'Dodge Back',
  'Counter':         'Arm Twist Counter',
  'Hit_Chest':       'Left Hit',
  'Hit_Head':        'Right Hit',
  'Hit_Heavy':       'Hard_Hit_Front',
  'Hit_Kick':        'Shooting Hit Reaction',
  'Hit_KickR':       'Round Kick Reaction',
  'Hit_KickM':       'Mma Kick Reverse Reaction',
  'Hit_Uppercut':    'Uppercut Reaction',
  'Death01':         'Knock Down Front',
  'Death02':         'knock_down_back',
  'GetUp':           'Getting Up',
  'Lying_Down':      'Lying Down',
  'Finisher':        'Finisher Combo Kick',
};

const PLAYER_COLLISION_DIST = 1.56;
const PLAYER_ATTACK_SEPARATION_DIST = 1.56;
const PLAYER_BODY_COLLISION_DIST = 0.84;
const PLAYER_ATTACK_BODY_SEPARATION_DIST = 0.78;
const FACE_TURN_DEADZONE = 0.03;
const PUSH_APART_SLOP = 0.035;
const PUSH_APART_STRENGTH = 0.38;
const ROOT_MOTION_TRACK_SUFFIXES = ['.position', '.translation'];
const ROOT_MOTION_RULES = [
  { pattern: 'soldier_team3_unlit', axes: 'xyz' },
  { pattern: 'armature', axes: 'xyz' },
  { pattern: 'mixamorig_hips', axes: 'xz' },
];

function trackNameMatches(trackName, pattern) {
  const lower = trackName.toLowerCase();
  return lower === pattern || lower.startsWith(`${pattern}.`) || lower.includes(`${pattern}.`);
}

function sanitizeRootMotionTrack(track, axes) {
  const clonedTrack = track.clone();
  const values = clonedTrack.values?.slice?.();
  if (!values || values.length < 3) return track;

  const x0 = values[0];
  const y0 = values[1];
  const z0 = values[2];
  for (let i = 0; i < values.length; i += 3) {
    if (axes.includes('x')) values[i] = x0;
    if (axes.includes('y')) values[i + 1] = y0;
    if (axes.includes('z')) values[i + 2] = z0;
  }
  clonedTrack.values = values;
  return clonedTrack;
}

function sanitizeAnimationClip(clip) {
  const clonedClip = clip.clone();
  clonedClip.tracks = clonedClip.tracks.map(track => {
    const lowerName = track.name.toLowerCase();
    const isRootMotionTrack = ROOT_MOTION_TRACK_SUFFIXES.some(suffix => lowerName.endsWith(suffix));
    if (!isRootMotionTrack) return track;

    for (const rule of ROOT_MOTION_RULES) {
      if (trackNameMatches(lowerName, rule.pattern)) {
        return sanitizeRootMotionTrack(track, rule.axes);
      }
    }

    return track;
  });
  return clonedClip;
}

export class Player {
  constructor(id, startX, classDef, toastEl) {
    this.id = id;
    this.startX = startX;
    this.classDef = classDef;
    this.toastEl = toastEl;
    this.tint = new THREE.Color(classDef.color);

    // Stats from class
    this.maxHealth = classDef.stats.maxHealth;
    this.walkSpeed = classDef.stats.walkSpeed;
    this.sprintSpeed = classDef.stats.sprintSpeed;

    // Runtime state
    this.mixer = null;
    this.model = null;
    this.animations = {};
    this.currentAction = null;
    this.currentAnimName = 'Idle_Loop';
    this.toastTimeout = null;
    this.health = this.maxHealth;
    this.combo = 0;
    this.comboTimeout = null;
    this.isStunned = false;
    this.stunTimer = 0;        // game-time stun countdown
    this.attackHitChecked = false;
    this.attackElapsed = 0;   // game-time seconds since attack started
    this.gameOver = false;

    // Movement tracking (used by combat dodge logic)
    this.isMoving = false;
    this.velocity = new THREE.Vector3();

    // Block state
    this.isBlocking = false;
    this.knockbackVel = new THREE.Vector3();

    // Bone references for hand/foot-level hit detection
    this.rightHand = null;
    this.leftHand = null;
    this.rightFoot = null;
    this.leftFoot = null;
    this.spine = null;
    this.boneNames = []; // debug
    this._oneShotDone = null; // tracks active finished-event listener
    this.idlePhaseOffset = Math.random() * Math.PI * 2; // per-fighter breathing phase
    this.rootMotionLocks = [];
  }

  init(gltf) {
    this.model = gltf.scene;
    this.model.userData.isPlayer = true;
    this.model.position.set(this.startX, getFloorY(), 0);

    this.model.traverse(child => {
      if (child.isMesh) {
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        const isShadowHelper =
          child.name?.toLowerCase().includes('spritemesh') ||
          child.parent?.name?.toLowerCase().includes('shadow') ||
          mats.some(m => m?.name?.toLowerCase().includes('shadow'));

        if (isShadowHelper) {
          child.visible = false;
          child.castShadow = false;
          child.receiveShadow = false;
          return;
        }

        child.castShadow = true;
        child.receiveShadow = true;
        child.material = mats.map(m => {
          const cm = m.clone();
          cm.roughness = 0.5;
          cm.metalness = 0.2;
          if (cm.color) cm.color = cm.color.clone().lerp(this.tint, 0.45);
          if (cm.emissive !== undefined) cm.emissive = this.tint.clone().multiplyScalar(0.14);
          return cm;
        });
        if (child.material.length === 1) child.material = child.material[0];
      }
    });

    scene.add(this.model);
    this.mixer = new THREE.AnimationMixer(this.model);

    gltf.animations.forEach(clip => {
      const sanitizedClip = sanitizeAnimationClip(clip);
      const action = this.mixer.clipAction(sanitizedClip);
      action.zeroSlopeAtStart = true;
      action.zeroSlopeAtEnd = true;
      this.animations[clip.name] = action;
    });

    // Find hand/foot/spine bones — search ALL objects (GLB skeletons are Object3D not THREE.Bone)
    const skip = ['index','middle','thumb','ring','pinky'];
    this.model.traverse(obj => {
      if (!obj.name) return;
      const n = obj.name.toLowerCase();
      this.boneNames.push(obj.name);
      const hasSkip = skip.some(s => n.includes(s));
      if (!hasSkip) {
        if (n.includes('righthand') && !this.rightHand) this.rightHand = obj;
        if (n.includes('lefthand')  && !this.leftHand)  this.leftHand  = obj;
      }
      if (!this.rightFoot && (
        n.includes('rightfoot') ||
        n.includes('foot_r') ||
        n.includes('r_foot') ||
        n.includes('righttoe') ||
        n.includes('toe_r') ||
        n.includes('rightankle')
      )) this.rightFoot = obj;
      if (!this.leftFoot && (
        n.includes('leftfoot') ||
        n.includes('foot_l') ||
        n.includes('l_foot') ||
        n.includes('lefttoe') ||
        n.includes('toe_l') ||
        n.includes('leftankle')
      )) this.leftFoot = obj;
      // spine/chest for body hit target
      if (!this.spine && (n.includes('spine1') || n.includes('chest') || n.includes('spine'))) {
        this.spine = obj;
      }

      if (n === 'armature' || n === 'soldier_team3_unlit') {
        this.rootMotionLocks.push({ obj, base: obj.position.clone(), axes: 'xyz' });
      } else if (n === 'mixamorig_hips') {
        this.rootMotionLocks.push({ obj, base: obj.position.clone(), axes: 'xz' });
      }
    });

    // Debug — print all found bone names
    console.log(`[${this.id}] Bones found: RightHand=${this.rightHand?.name} LeftHand=${this.leftHand?.name} RightFoot=${this.rightFoot?.name} LeftFoot=${this.leftFoot?.name} Spine=${this.spine?.name}`);
    if (!this.rightHand) {
      console.warn(`[${this.id}] Hand bones not found. All names:`, this.boneNames.filter(n => n.length > 2).join(', '));
    }

    this.play('Idle_Loop', 0.3);
  }

  getKickContactPos() {
    if (!this.model) return null;
    const forward = new THREE.Vector3(Math.sin(this.model.rotation.y), 0, Math.cos(this.model.rotation.y));
    const scoredFeet = [this.rightFoot, this.leftFoot]
      .filter(Boolean)
      .map(bone => {
        const pos = new THREE.Vector3();
        bone.getWorldPosition(pos);
        const planarOffset = pos.clone().sub(this.model.position).setY(0);
        return { pos, score: planarOffset.dot(forward) + planarOffset.length() * 0.2 };
      });

    if (scoredFeet.length > 0) {
      scoredFeet.sort((a, b) => b.score - a.score);
      return scoredFeet[0].pos;
    }

    // Fallback if foot bones are missing: approximate the striking foot position in front of the torso.
    const pos = this.model.position.clone();
    pos.addScaledVector(forward, 0.95);
    pos.y += 0.78;
    return pos;
  }

  // Returns world position of the active hand/foot contact point based on current attack
  getAttackContactPos() {
    if (!this.model) return null;
    const anim = this.currentAnimName;
    const kickAtks = new Set(['Kick_Front', 'Kick_Round', 'Kick_MMA', 'Kick_Side']);
    if (kickAtks.has(anim)) {
      return this.getKickContactPos();
    }

    // Map attacks to which hand they use
    const leftHandAtks  = new Set(['Jab','Hook','Body_Punch_L','Uppercut_Combo']);
    const rightHandAtks = new Set(['Cross','Hook_Right','Uppercut','Body_Punch','Elbow','Counter']);

    let bone = null;
    if (leftHandAtks.has(anim) && this.leftHand)   bone = this.leftHand;
    else if (rightHandAtks.has(anim) && this.rightHand) bone = this.rightHand;
    else if (this.rightHand) bone = this.rightHand; // fallback

    if (!bone) return null;
    const pos = new THREE.Vector3();
    bone.getWorldPosition(pos);
    return pos;
  }

  // Backward-compatible alias used by older combat checks.
  getAttackHandPos() {
    return this.getAttackContactPos();
  }

  // Returns world position of the body center (chest area) for receiving hits
  getBodyPos() {
    if (!this.model) return null;
    const pos = this.model.position.clone();
    pos.y += 1.1; // chest height
    if (this.spine) {
      this.spine.getWorldPosition(pos);
    }
    return pos;
  }

  clearOneShotListener() {
    if (this._oneShotDone && this.mixer) {
      this.mixer.removeEventListener('finished', this._oneShotDone);
      this._oneShotDone = null;
    }
  }

  applyRootMotionLocks() {
    for (const lock of this.rootMotionLocks) {
      if (!lock.obj) continue;
      if (lock.axes.includes('x')) lock.obj.position.x = lock.base.x;
      if (lock.axes.includes('y')) lock.obj.position.y = lock.base.y;
      if (lock.axes.includes('z')) lock.obj.position.z = lock.base.z;
    }
  }

  play(name, fadeDuration = 0.35) {
    if (this.gameOver && !['Death01', 'Death02', 'Lying_Down', 'Idle_Loop'].includes(name)) return;
    const reactionAnims = [
      'Hit_Chest','Hit_Head','Hit_Heavy','Hit_Kick','Hit_KickR','Hit_KickM','Hit_Uppercut',
      'Death01','Death02','Block_Loop'
    ];
    if (this.isStunned && !reactionAnims.includes(name)) return;

    const resolvedName = ANIM_MAP[name] ?? name;
    const action = this.animations[resolvedName];
    if (!action) return;
    const isOneShot = ONE_SHOT.includes(name);
    if (this.currentAction === action && !isOneShot) return;

    this.clearOneShotListener();
    const previousAction = this.currentAction && this.currentAction !== action ? this.currentAction : null;

    action.enabled = true;
    action.setEffectiveWeight(1);
    action.setEffectiveTimeScale(1);
    action.reset();
    action.play();

    if (previousAction && fadeDuration > 0) {
      previousAction.enabled = true;
      action.crossFadeFrom(previousAction, fadeDuration, false);
    } else if (previousAction) {
      previousAction.stop();
    } else if (!previousAction && fadeDuration > 0) {
      action.fadeIn(fadeDuration);
    }
    this.currentResolvedName = resolvedName;

    // Per-animation speed — makes punches snappy and sprint visually distinct
    const ANIM_SPEED = {
      'Jab': 1.28, 'Hook': 1.16, 'Hook_Right': 1.16, 'Cross': 1.2,
      'Uppercut': 1.12, 'Uppercut_Combo': 1.08, 'Body_Punch': 1.16, 'Body_Punch_L': 1.16,
      'Kick_Front': 1.02, 'Kick_Round': 0.98, 'Kick_MMA': 0.95, 'Kick_Side': 1.0,
      'Elbow': 1.22, 'Counter': 1.12, 'Roll': 1.35,
      'Walk_Loop': 1.15, 'Walk_Back_Loop': 1.0,
      'Sprint_Loop': 1.65,
    };
    action.timeScale = ANIM_SPEED[name] ?? 1.0;

    if (isOneShot) {
      action.setLoop(THREE.LoopOnce);
      action.clampWhenFinished = true;
      const capturedName = name;
      const onDone = (e) => {
        if (e.action !== action) return; // only react to this specific action
        this.mixer.removeEventListener('finished', onDone);
        this._oneShotDone = null;
        // Only return to idle if no other animation has taken over since
        if (!this.gameOver && this.currentAnimName === capturedName) {
          this.play('Idle_Loop', 0.35);
        }
      };
      this._oneShotDone = onDone;
      this.mixer.addEventListener('finished', onDone);
    } else {
      action.setLoop(THREE.LoopRepeat);
    }

    this.currentAction = action;
    this.currentAnimName = name;
    this.isBlocking = (name === BLOCK_ANIM);

    if (ATTACKS[name]) {
      this.attackHitChecked = false;
      this.attackElapsed = 0;  // reset — ticked by update(dt)
    }

    if (ATTACKS[name] || name === 'Roll' || name === BLOCK_ANIM) {
      playAttackSwingSound(name);
    }

    this.showToast(name);
  }

  showToast(name) {
    const pretty = name.replace(/_/g, ' ').replace(' Loop', '').replace(' RM', '');
    this.toastEl.textContent = pretty;
    this.toastEl.classList.add('show');
    clearTimeout(this.toastTimeout);
    this.toastTimeout = setTimeout(() => this.toastEl.classList.remove('show'), 1200);
  }

  faceTarget(targetPos) {
    if (!this.model) return;
    const dir = new THREE.Vector3().subVectors(targetPos, this.model.position);
    dir.y = 0;
    if (dir.length() > 0.1) {
      const angle = Math.atan2(dir.x, dir.z);
      let diff = angle - this.model.rotation.y;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      if (Math.abs(diff) <= FACE_TURN_DEADZONE) return;
      const closeRange = dir.length() < 1.9;
      // Clamp max rotation per frame to prevent spinning
      const maxRot = closeRange ? 0.11 : 0.18;
      const turnStrength = closeRange ? 0.16 : 0.22;
      this.model.rotation.y += Math.max(-maxRot, Math.min(maxRot, diff * turnStrength));
    }
  }

  move(dx, dz, speed, dt, otherPlayer) {
    if (!this.model || this.isStunned || this.gameOver) return false;

    const moveVec = new THREE.Vector3(dx, 0, dz).normalize().multiplyScalar(speed * dt);
    const newPos = this.model.position.clone().add(moveVec);

    // Keep fighters close enough for contact while still preventing visible torso overlap.
    if (otherPlayer?.model) {
      const separation = this.getSeparationState(otherPlayer, PLAYER_COLLISION_DIST, moveVec);
      if (separation.rootDist < separation.rootMinDist || separation.bodyDist < separation.bodyMinDist) {
        return false;
      }
    }

    this.model.position.copy(newPos);

    // Clamp to arena
    const d = Math.sqrt(newPos.x ** 2 + newPos.z ** 2);
    if (d > arenaRadius) {
      this.model.position.x *= arenaRadius / d;
      this.model.position.z *= arenaRadius / d;
    }

    // Track velocity for dodge calculations
    this.velocity.copy(moveVec).divideScalar(dt);
    this.isMoving = true;
    return true;
  }

  clearMovement() {
    this.isMoving = false;
    this.velocity.set(0, 0, 0);
  }

  takeDamage(amount, reactionAnim, wasBlocked = false, attacker = null) {
    if (this.gameOver) return;
    this.health = Math.max(0, this.health - amount);

    if (this.health <= 0) {
      this.gameOver = true;
      this.isStunned = false;
      this.isBlocking = false;
      this.stunTimer = 0;
      this.deathDelay = 0;
      // Play KO animation immediately — random front or back knockdown
      this.clearOneShotListener();
      if (this.currentAction) { this.currentAction.stop(); this.currentAction = null; }
      this.currentAnimName = 'Idle_Loop';
      const koAnim = Math.random() > 0.5 ? 'Death01' : 'Death02';
      this.play(koAnim, 0.05);
      return;
    }

    if (wasBlocked && this.isBlocking) {
      if (attacker?.model && this.model) {
        const blockDir = new THREE.Vector3().subVectors(this.model.position, attacker.model.position);
        blockDir.y = 0;
        if (blockDir.lengthSq() > 0.0001) {
          this.knockbackVel = blockDir.normalize().multiplyScalar(0.05 + amount * 0.002);
        }
        this.pushApart(attacker, PLAYER_ATTACK_SEPARATION_DIST);
      }
      return;
    }

    // Play reaction FIRST before any freeze so it's queued correctly
    // Force stop current animation then play reaction
    this.clearOneShotListener();
    if (this.currentAction) {
      this.currentAction.stop();
      this.currentAction = null;
    }
    this.isStunned = true;
    this.stunTimer = Math.min(0.65, 0.3 + amount * 0.012);
    this.currentAnimName = 'Idle_Loop'; // reset so stun guard allows reaction
    this.play(reactionAnim, 0.0); // zero fade = instant reaction

    // Knock back away from the attacker so hit reactions do not slide inward.
    if (this.model) {
      const knockForce = Math.min(0.32, 0.08 + amount * 0.008);
      const knockDir = new THREE.Vector3();
      if (attacker?.model) {
        knockDir.subVectors(this.model.position, attacker.model.position);
        knockDir.y = 0;
      }
      if (knockDir.lengthSq() < 0.0001) {
        knockDir.set(Math.sin(this.model.rotation.y), 0, Math.cos(this.model.rotation.y));
      }
      this.knockbackVel = knockDir.normalize().multiplyScalar(knockForce);
      if (attacker?.model) {
        this.pushApart(attacker, PLAYER_ATTACK_SEPARATION_DIST);
      }
    }

    // Small camera shake instead of mixer freeze (freeze interferes with reaction)
    // Shake is handled by main.js via shakeIntensity
  }

  reset() {
    this.health = this.maxHealth;
    this.combo = 0;
    this.isStunned = false;
    this.gameOver = false;
    this.attackHitChecked = false;
    this.isMoving = false;
    this.isBlocking = false;
    this.stunTimer = 0;
    this.deathDelay = 0;
    this.currentAnimName = 'Idle_Loop';
    this.velocity.set(0, 0, 0);
    this.knockbackVel.set(0, 0, 0);
    clearTimeout(this.comboTimeout);
    this.clearOneShotListener();

    // Stop all animations cleanly and restore mixer
    if (this.mixer) {
      this.mixer.stopAllAction();
      this.mixer.timeScale = 1;
    }
    this.currentAction = null;

    if (this.model) {
      this.model.position.set(this.startX, getFloorY(), 0);
      // Reset rotation to face center
      this.model.rotation.y = this.startX < 0 ? Math.PI / 2 : -Math.PI / 2;
    }

    this.play('Idle_Loop', 0.1);
  }

  getSeparationState(other, minRootDist = PLAYER_COLLISION_DIST, moveOffset = null) {
    const inCloseCombat = Boolean(
      ATTACKS[this.currentAnimName] ||
      ATTACKS[other.currentAnimName] ||
      this.isStunned ||
      other.isStunned
    );
    const rootMinDist = inCloseCombat
      ? Math.max(minRootDist, PLAYER_ATTACK_SEPARATION_DIST)
      : minRootDist;
    const bodyMinDist = inCloseCombat
      ? PLAYER_ATTACK_BODY_SEPARATION_DIST
      : PLAYER_BODY_COLLISION_DIST;

    const thisRoot = this.model.position.clone();
    const otherRoot = other.model.position.clone();
    if (moveOffset) thisRoot.add(moveOffset);

    const rootDiff = new THREE.Vector3().subVectors(thisRoot, otherRoot);
    rootDiff.y = 0;

    const thisBody = this.getBodyPos()?.clone() ?? thisRoot.clone().setY(getFloorY() + 1.1);
    const otherBody = other.getBodyPos?.()?.clone() ?? otherRoot.clone().setY(getFloorY() + 1.1);
    if (moveOffset) thisBody.add(moveOffset);
    thisBody.y = 0;
    otherBody.y = 0;

    const bodyDiff = new THREE.Vector3().subVectors(thisBody, otherBody);

    return {
      rootDiff,
      bodyDiff,
      rootDist: rootDiff.length(),
      bodyDist: bodyDiff.length(),
      rootMinDist,
      bodyMinDist,
    };
  }

  pushApart(other, minDist = PLAYER_COLLISION_DIST) {
    if (!this.model || !other.model) return;
    const separation = this.getSeparationState(other, minDist);
    const overlap = Math.max(
      separation.rootMinDist - separation.rootDist,
      separation.bodyMinDist - separation.bodyDist,
      0
    );

    if (overlap > PUSH_APART_SLOP) {
      const diff = separation.bodyDiff.lengthSq() > 0.0001
        ? separation.bodyDiff
        : separation.rootDiff;
      if (diff.lengthSq() <= 0.0001) {
        diff.set(
          Math.sin(this.model.rotation.y) || 1,
          0,
          Math.cos(this.model.rotation.y) || 0
        );
      }
      const push = diff.normalize().multiplyScalar((overlap - PUSH_APART_SLOP + 0.01) * PUSH_APART_STRENGTH);
      this.model.position.add(push);
      other.model.position.sub(push);
    }
  }

  update(dt) {
    if (this.mixer) this.mixer.update(dt);
    this.applyRootMotionLocks();
    if (this.model) {
      // Apply knockback velocity with friction
      if (this.knockbackVel && this.knockbackVel.length() > 0.01) {
        this.model.position.addScaledVector(this.knockbackVel, dt * 10);
        this.knockbackVel.multiplyScalar(0.82); // friction
        // Clamp to arena
        const d = Math.sqrt(this.model.position.x ** 2 + this.model.position.z ** 2);
        if (d > arenaRadius) {
          this.model.position.x *= arenaRadius / d;
          this.model.position.z *= arenaRadius / d;
          this.knockbackVel.set(0, 0, 0);
        }
      }
      const breathe = (this.currentAnimName === 'Idle_Loop' || this.currentAnimName === 'Block_Loop')
        ? Math.sin(performance.now() * 0.0022 + this.idlePhaseOffset) * 0.005
        : 0;
      this.model.position.y = getFloorY() + breathe;
    }

    // Attack elapsed in game-time
    if (ATTACKS[this.currentAnimName] && !this.attackHitChecked) {
      this.attackElapsed += dt;
    }

    // Stun countdown in game-time
    if (this.isStunned && this.stunTimer > 0) {
      this.stunTimer -= dt;
      if (this.stunTimer <= 0) {
        this.isStunned = false;
      }
    }

  }
}
