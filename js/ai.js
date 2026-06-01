import * as THREE from 'three';
import { ATTACKS } from './combat.js';
import { BLOCK_ANIM } from './classes.js';
import { Brain, BRAIN_ACTIONS, initBrainCombatRef } from './brain.js';
import { activeDifficulty } from './difficulty.js';

initBrainCombatRef(ATTACKS);

/**
 * AI Controller v3 — forward/backward only, no strafing.
 * Movement is purely toward or away from opponent, like a real 1v1 fighting game.
 */
export class AIController {
  constructor(player, opponent, actions, useBrain = false) {
    this.player = player;
    this.opponent = opponent;
    this.actions = actions;
    this.useBrain = useBrain;
    this.combatActions = actions.filter(a => a.category === 'combat');

    this.decisionTimer = 0;
    this.decisionInterval = activeDifficulty.aiDecisionSpeed;
    this.attackCooldown = 0;
    this.isSprinting = false;
    this.moveForward = 0; // 1=toward opp, -1=away, 0=stand
    this.currentMoveAnim = null;

    this.wantsBlock = false;
    this.blockTimer = 0;
    this.counterPhase = 0;
    this.counterTimer = 0;

    this.brain = useBrain ? new Brain(player.id) : null;

    this.lastHealth = player.maxHealth;
    this.lastOppHealth = opponent.maxHealth || 100;
    this.tickRewardTimer = 0;

    this.onAction = null;
  }

  update(dt) {
    const p = this.player;
    const opp = this.opponent;
    if (!p.model || !opp.model || p.gameOver) return;

    const toOpp = new THREE.Vector3().subVectors(opp.model.position, p.model.position);
    toOpp.y = 0;
    const distance = toOpp.length();
    const dirToOpp = toOpp.clone().normalize();

    this.attackCooldown -= dt;
    this.blockTimer -= dt;
    this.decisionTimer -= dt;
    this.tickRewardTimer -= dt;
    this.counterTimer -= dt;

    // Counter combo: block phase -> attack phase
    if (this.counterPhase === 1 && this.counterTimer <= 0) {
      this.counterPhase = 2;
      this.counterTimer = 0.15;
      this.wantsBlock = false;
      if (p.isBlocking) p.play('Idle_Loop', 0.05);
    }
    if (this.counterPhase === 2 && this.counterTimer <= 0) {
      this.counterPhase = 0;
      this._tryAttack();
    }

    // --- Reward shaping ---
    if (this.brain && this.tickRewardTimer <= 0) {
      this.tickRewardTimer = 0.15;
      let r = 0;

      if (distance < 1.8) r += 2.0;
      else if (distance < 2.5) r += 0.5;
      else if (distance > 4.0) r -= 3.0;
      else if (distance > 3.0) r -= 1.5;

      const dmgDealt = this.lastOppHealth - opp.health;
      const dmgTaken = this.lastHealth - p.health;

      if (dmgDealt > 0) {
        r += dmgDealt * 1.5;
        this.brain.roundDamageDealt += dmgDealt;
        if (!opp.isStunned) r += 3.0;
      }
      if (dmgTaken > 0) {
        r -= dmgTaken * 0.8;
        if (p.currentAnimName === 'Idle_Loop') r -= 5.0;
      }
      // Punish passive play — idling OR blocking when close
      if (distance < 2.5 && !p.isStunned) {
        if (p.currentAnimName === 'Idle_Loop') r -= 3.0;
        if (p.isBlocking) r -= 2.0;  // blocking is NOT a strategy, it's a reaction
      }
      // Reward being mid-attack
      if (distance < 2.0 && ATTACKS[p.currentAnimName]) {
        r += 1.5;
      }

      this.lastHealth = p.health;
      this.lastOppHealth = opp.health;

      const state = this.brain.getState(distance, p, opp);
      this.brain.learn(state, r);
    }

    // --- Reactive block: on harder difficulties, AI auto-blocks incoming attacks ---
    if (!p.isStunned && !p.isBlocking && !this.wantsBlock && distance < 2.5 &&
        ATTACKS[opp.currentAnimName] && Math.random() < activeDifficulty.aiBlockChance) {
      this.wantsBlock = true;
      this.blockTimer = 0.2;
      this.counterPhase = 1;
      this.counterTimer = 0.2;
    }

    // --- Decision (heuristic only for now — guaranteed to fight) ---
    if (this.decisionTimer <= 0) {
      this.decisionTimer = this.decisionInterval;
      this._heuristic(distance);
    }

    // Attack when in range and cooldown ready
    if (distance < 2.5 && !p.isStunned &&
        this.attackCooldown <= 0 && !ATTACKS[p.currentAnimName]) {
      this._tryAttackAtDistance(distance);
    }

    // --- Apply movement (forward/backward only) ---
    this._applyMovement(dt, dirToOpp, opp);
  }

  _execute(actionIdx, distance) {
    const p = this.player;
    const action = BRAIN_ACTIONS[actionIdx];

    if (action !== 'block' && action !== 'counter') {
      this.wantsBlock = false;
    }

    // Reset movement
    this.moveForward = 0;
    this.isSprinting = false;

    switch (action) {
      case 'rush_attack':
        this.moveForward = 1;
        this.isSprinting = true;
        if (distance < 2.5) this._tryAttack();
        break;

      case 'attack':
        if (distance > 2.0) this.moveForward = 1;
        this._tryAttack();
        break;

      case 'block':
        this.wantsBlock = true;
        this.blockTimer = 0.25 + Math.random() * 0.15;
        break;

      case 'advance':
        this.moveForward = 1;
        this.isSprinting = distance > 3;
        if (distance < 2.5) this._tryAttack();
        break;

      case 'roll':
        this.moveForward = 1;
        if (this.attackCooldown <= 0 && !p.isStunned && !ATTACKS[p.currentAnimName]) {
          p.play('Roll', 0.05);
          this._logAction('Roll');
          this.attackCooldown = 0.3;
        }
        break;

      case 'counter':
        this.wantsBlock = true;
        this.blockTimer = 0.2;
        this.counterPhase = 1;
        this.counterTimer = 0.2;
        break;

      case 'retreat':
        this.moveForward = -1;
        this.isSprinting = false;
        break;
    }
  }

  _tryAttack() {
    const p = this.player;
    if (this.attackCooldown > 0 || p.isStunned || ATTACKS[p.currentAnimName]) return;
    if (this.combatActions.length === 0) return;
    const atk = this.combatActions[Math.floor(Math.random() * this.combatActions.length)];
    p.play(atk.anim, 0.05);
    this._logAction(atk.anim);
    this.attackCooldown = 0.35 + Math.random() * 0.25;
  }

  _heuristic(distance) {
    const p = this.player;

    this.wantsBlock = false;

    if (distance > 1.6) {
      this.moveForward = 1;
      this.isSprinting = distance > 2.5;
    } else {
      this.moveForward = 0;
      if (!p.isStunned) this._tryAttackAtDistance(distance);
    }
  }

  _tryAttackAtDistance(distance) {
    if (this.attackCooldown > 0 || this.player.isStunned) return;
    if (ATTACKS[this.player.currentAnimName]) return;
    if (this.combatActions.length === 0) return;

    const atk = this.combatActions[Math.floor(Math.random() * this.combatActions.length)];
    this.player.play(atk.anim, 0.05);
    this.attackCooldown = 0.35 + Math.random() * 0.25;
  }

  _applyMovement(dt, dirToOpp, opp) {
    const p = this.player;

    // Block
    if (this.wantsBlock && this.blockTimer > 0 && !p.isStunned) {
      if (!p.isBlocking) p.play(BLOCK_ANIM, 0.05);
    } else if (this.wantsBlock && this.blockTimer <= 0) {
      this.wantsBlock = false;
      if (p.isBlocking) p.play('Idle_Loop', 0.05);
    }

    // Movement — forward/backward along the line to opponent
    if (this.moveForward !== 0 && !p.isStunned && !this.wantsBlock) {
      const speed = this.isSprinting ? p.sprintSpeed : p.walkSpeed;
      const moveDir = dirToOpp.clone().multiplyScalar(this.moveForward);
      p.move(moveDir.x, moveDir.z, speed, dt, opp);

      let anim;
      if (this.isSprinting) anim = 'Walk_Loop';
      else if (this.moveForward > 0) anim = 'Walk_Loop';
      else anim = 'Walk_Back_Loop';

      if (this.currentMoveAnim !== anim) {
        this.currentMoveAnim = anim;
        p.play(anim, 0.08);
      }
    } else if (this.moveForward === 0 && this.currentMoveAnim) {
      this.currentMoveAnim = null;
      p.clearMovement();
      if (!p.isStunned && !this.wantsBlock && !p.isBlocking) p.play('Idle_Loop', 0.05);
    } else if (this.moveForward === 0) {
      p.clearMovement();
    }
  }

  reward(value) {
    if (this.brain) {
      const dist = this.player.model && this.opponent.model
        ? this.player.model.position.distanceTo(this.opponent.model.position) : 3;
      const state = this.brain.getState(dist, this.player, this.opponent);
      this.brain.learn(state, value);
    }
  }

  endRound(won) {
    if (this.brain) this.brain.endRound(won);
    this.lastHealth = this.player.maxHealth;
    this.lastOppHealth = this.opponent.maxHealth || 100;
  }

  _logAction(animName) {
    if (this.onAction) this.onAction(this.player.id, animName);
  }

  reset() {
    this.decisionTimer = 0;
    this.attackCooldown = 0;
    this.moveForward = 0;
    this.currentMoveAnim = null;
    this.wantsBlock = false;
    this.blockTimer = 0;
    this.counterPhase = 0;
    this.counterTimer = 0;
    this.tickRewardTimer = 0;
    this.lastHealth = this.player.maxHealth;
    this.lastOppHealth = this.opponent?.maxHealth || 100;
  }
}
