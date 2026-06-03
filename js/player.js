import * as THREE from 'three';
import { scene, arenaRadius } from './scene.js';
import { ONE_SHOT, ATTACKS } from './combat.js';
import { BLOCK_ANIM } from './classes.js';
import { activeDifficulty } from './difficulty.js';
import { getFloorY } from './scene.js';

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

const PLAYER_COLLISION_DIST = 1.5;

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

    // Bone references for wrist-level hit detection
    this.rightHand = null;
    this.leftHand = null;
    this.spine = null;
    this.boneNames = []; // debug
    this._oneShotDone = null; // tracks active finished-event listener
    this.idlePhaseOffset = Math.random() * Math.PI * 2; // per-fighter breathing phase
  }

  init(gltf) {
    this.model = gltf.scene;
    this.model.userData.isPlayer = true;
    this.model.position.set(this.startX, getFloorY(), 0);

    this.model.traverse(child => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
        const mats = Array.isArray(child.material) ? child.material : [child.material];
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
      this.animations[clip.name] = this.mixer.clipAction(clip);
    });

    // Find hand/spine bones — search ALL objects (GLB skeletons are Object3D not THREE.Bone)
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
      // spine/chest for body hit target
      if (!this.spine && (n.includes('spine1') || n.includes('chest') || n.includes('spine'))) {
        this.spine = obj;
      }
    });

    // Debug — print all found bone names
    console.log(`[${this.id}] Bones found: RightHand=${this.rightHand?.name} LeftHand=${this.leftHand?.name} Spine=${this.spine?.name}`);
    if (!this.rightHand) {
      console.warn(`[${this.id}] Hand bones not found. All names:`, this.boneNames.filter(n => n.length > 2).join(', '));
    }

    this.play('Idle_Loop', 0.3);
  }

  // Returns world position of the attacking wrist bone based on current attack
  getAttackHandPos() {
    if (!this.model) return null;
    const anim = this.currentAnimName;

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

  play(name, fadeDuration = 0.35) {
    if (this.gameOver && !['Death01', 'Death02', 'Lying_Down', 'Idle_Loop'].includes(name)) return;
    const reactionAnims = ['Hit_Chest','Hit_Head','Hit_Heavy','Death01','Death02','Block_Loop'];
    if (this.isStunned && !reactionAnims.includes(name)) return;

    const resolvedName = ANIM_MAP[name] ?? name;
    const action = this.animations[resolvedName];
    if (!action) return;
    const isOneShot = ONE_SHOT.includes(name);
    if (this.currentAction === action && !isOneShot) return;

    if (this.currentAction) this.currentAction.fadeOut(fadeDuration);
    action.reset().fadeIn(fadeDuration).play();
    this.currentResolvedName = resolvedName;

    // Per-animation speed — makes punches snappy and sprint visually distinct
    const ANIM_SPEED = {
      'Jab': 1.4, 'Hook': 1.25, 'Hook_Right': 1.25, 'Cross': 1.3,
      'Uppercut': 1.2, 'Uppercut_Combo': 1.15, 'Body_Punch': 1.25, 'Body_Punch_L': 1.25,
      'Elbow': 1.45, 'Counter': 1.2, 'Roll': 1.35,
      'Walk_Loop': 1.15, 'Walk_Back_Loop': 1.0,
      'Sprint_Loop': 1.65,
    };
    action.timeScale = ANIM_SPEED[name] ?? 1.0;

    if (isOneShot) {
      action.setLoop(THREE.LoopOnce);
      action.clampWhenFinished = true;
      // Remove any previous listener to prevent stale idle transitions
      if (this._oneShotDone) {
        this.mixer.removeEventListener('finished', this._oneShotDone);
        this._oneShotDone = null;
      }
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
      // Clamp max rotation per frame to prevent spinning
      const maxRot = 0.18;
      this.model.rotation.y += Math.max(-maxRot, Math.min(maxRot, diff * 0.22));
    }
  }

  move(dx, dz, speed, dt, otherPlayer) {
    if (!this.model || this.isStunned || this.gameOver) return;

    const moveVec = new THREE.Vector3(dx, 0, dz).normalize().multiplyScalar(speed * dt);
    const newPos = this.model.position.clone().add(moveVec);

    // Keep fighters close enough for contact while still preventing mesh overlap.
    if (otherPlayer?.model) {
      if (newPos.distanceTo(otherPlayer.model.position) < PLAYER_COLLISION_DIST) return;
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
      if (this.currentAction) { this.currentAction.stop(); this.currentAction = null; }
      this.currentAnimName = 'Idle_Loop';
      const koAnim = Math.random() > 0.5 ? 'Death01' : 'Death02';
      this.play(koAnim, 0.05);
      return;
    }

    if (wasBlocked && this.isBlocking) return;

    // Play reaction FIRST before any freeze so it's queued correctly
    // Force stop current animation then play reaction
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

  pushApart(other, minDist = PLAYER_COLLISION_DIST) {
    if (!this.model || !other.model) return;
    const diff = new THREE.Vector3().subVectors(this.model.position, other.model.position);
    diff.y = 0;
    const dist = diff.length();
    if (dist < minDist) {
      if (dist <= 0.01) {
        diff.set(
          Math.sin(this.model.rotation.y) || 1,
          0,
          Math.cos(this.model.rotation.y) || 0
        );
      }
      const push = diff.normalize().multiplyScalar((minDist - Math.max(dist, 0.001)) * 0.5);
      this.model.position.add(push);
      other.model.position.sub(push);
    }
  }

  update(dt) {
    if (this.mixer) this.mixer.update(dt);
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
