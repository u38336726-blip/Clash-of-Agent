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
  }

  init(gltf) {
    this.model = gltf.scene;
    this.model.position.set(this.startX, getFloorY(), 0);

    this.model.traverse(child => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        child.material = mats.map(m => {
          const cm = m.clone();
          cm.roughness = 0.6;
          cm.metalness = 0.1;
          if (cm.color) cm.color = cm.color.clone().lerp(this.tint, 0.15);
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

    if (isOneShot) {
      action.setLoop(THREE.LoopOnce);
      action.clampWhenFinished = true;
      const onDone = () => {
        this.mixer.removeEventListener('finished', onDone);
        if (!this.gameOver) this.play('Idle_Loop', 0.4);
      };
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
      const maxRot = 0.12;
      this.model.rotation.y += Math.max(-maxRot, Math.min(maxRot, diff * 0.15));
    }
  }

  move(dx, dz, speed, dt, otherPlayer) {
    if (!this.model || this.isStunned || this.gameOver) return;

    const moveVec = new THREE.Vector3(dx, 0, dz).normalize().multiplyScalar(speed * dt);
    const newPos = this.model.position.clone().add(moveVec);

    // Collision with other player — keep at arm's reach so fists touch surface not inside
    if (otherPlayer?.model) {
      if (newPos.distanceTo(otherPlayer.model.position) < 1.4) return;
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

  takeDamage(amount, reactionAnim, wasBlocked = false) {
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
    this.stunTimer = Math.min(1.2, 0.5 + amount * 0.02);
    this.currentAnimName = 'Idle_Loop'; // reset so stun guard allows reaction
    this.play(reactionAnim, 0.0); // zero fade = instant reaction

    // Knockback — small push, keep characters close
    if (this.model) {
      const knockForce = Math.min(0.4, 0.1 + amount * 0.01);
      const knockDir = this.model.position.clone().normalize();
      if (knockDir.length() < 0.1) knockDir.set(1, 0, 0);
      this.knockbackVel = knockDir.multiplyScalar(knockForce);
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

  pushApart(other, minDist = 1.4) {
    if (!this.model || !other.model) return;
    const diff = new THREE.Vector3().subVectors(this.model.position, other.model.position);
    diff.y = 0;
    const dist = diff.length();
    if (dist < minDist && dist > 0.01) {
      const push = diff.normalize().multiplyScalar((minDist - dist) * 0.5);
      this.model.position.add(push);
      other.model.position.sub(push);
    }
  }

  update(dt) {
    if (this.mixer) this.mixer.update(dt);
    if (this.model) {
      // Apply knockback velocity with friction
      if (this.knockbackVel && this.knockbackVel.length() > 0.01) {
        this.model.position.addScaledVector(this.knockbackVel, dt * 20);
        this.knockbackVel.multiplyScalar(0.7); // friction
        // Clamp to arena
        const d = Math.sqrt(this.model.position.x ** 2 + this.model.position.z ** 2);
        if (d > arenaRadius) {
          this.model.position.x *= arenaRadius / d;
          this.model.position.z *= arenaRadius / d;
          this.knockbackVel.set(0, 0, 0);
        }
      }
      this.model.position.y = getFloorY();
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
