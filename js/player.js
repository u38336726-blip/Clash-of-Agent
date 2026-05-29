import * as THREE from 'three';
import { scene, arenaRadius } from './scene.js';
import { ONE_SHOT, ATTACKS } from './combat.js';
import { BLOCK_ANIM } from './classes.js';
import { activeDifficulty } from './difficulty.js';
import { getFloorY } from './scene.js';

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

    this.play('Idle_Loop', 0.3);
  }

  play(name, fadeDuration = 0.35) {
    if (this.gameOver && name !== 'Death01' && name !== 'Idle_Loop') return;
    if (this.isStunned && !['Hit_Chest', 'Hit_Head', 'Death01', 'Block_Loop'].includes(name)) return;

    const action = this.animations[name];
    if (!action) return;
    const isOneShot = ONE_SHOT.includes(name);
    if (this.currentAction === action && !isOneShot) return;

    if (this.currentAction) this.currentAction.fadeOut(fadeDuration);
    action.reset().fadeIn(fadeDuration).play();

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
      this.model.rotation.y += diff * 0.1;
    }
  }

  move(dx, dz, speed, dt, otherPlayer) {
    if (!this.model || this.isStunned || this.gameOver) return;

    const moveVec = new THREE.Vector3(dx, 0, dz).normalize().multiplyScalar(speed * dt);
    const newPos = this.model.position.clone().add(moveVec);

    // Collision with other player
    if (otherPlayer?.model) {
      if (newPos.distanceTo(otherPlayer.model.position) < 0.8) return;
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
      this.deathDelay = 0.3; // game-time seconds before death anim
      return;
    }

    // If blocking, stay in block — no stun, no reaction anim
    if (wasBlocked && this.isBlocking) return;

    this.isStunned = true;
    this.stunTimer = activeDifficulty.stunDuration;
    this.play(reactionAnim, 0.15);
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
    this.velocity.set(0, 0, 0);
    clearTimeout(this.comboTimeout);
    if (this.model) this.model.position.set(this.startX, getFloorY(), 0);
    this.play('Idle_Loop', 0.3);
  }

  update(dt) {
    if (this.mixer) this.mixer.update(dt);
    // Keep on correct floor level
    if (this.model) this.model.position.y = getFloorY();

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

    // Death delay in game-time
    if (this.deathDelay > 0) {
      this.deathDelay -= dt;
      if (this.deathDelay <= 0) {
        this.deathDelay = 0;
        this.play('Death01', 0.3);
      }
    }
  }
}
