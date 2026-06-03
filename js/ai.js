import * as THREE from 'three';
import { ATTACKS } from './combat.js';
import { BLOCK_ANIM } from './classes.js';
import { Brain, BRAIN_ACTIONS, initBrainCombatRef } from './brain.js';
import { activeDifficulty } from './difficulty.js';

initBrainCombatRef(ATTACKS);

const DEFAULT_FIGHT_DISTANCE = 1.56; // matches PLAYER_COLLISION_DIST — fighters stand at contact range
const DISTANCE_TOLERANCE = 0.25;    // wide enough to fire at collision boundary for all idealDist values

function getIdealAttackDistance(animName) {
  return ATTACKS[animName]?.idealDist ?? DEFAULT_FIGHT_DISTANCE;
}

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
    this.pendingAttack = null; // attack queued, waiting to reach ideal distance

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

    if (p.isStunned || p.gameOver || this.wantsBlock) {
      this.pendingAttack = null;
    }

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

      if (distance < 1.7) r += 2.0;
      else if (distance < 2.2) r += 0.5;
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
      if (distance < 2.2 && !p.isStunned) {
        if (p.currentAnimName === 'Idle_Loop') r -= 3.0;
        if (p.isBlocking) r -= 2.0;  // blocking is NOT a strategy, it's a reaction
      }
      // Reward being mid-attack
      if (distance < 1.8 && ATTACKS[p.currentAnimName]) {
        r += 1.5;
      }

      this.lastHealth = p.health;
      this.lastOppHealth = opp.health;

      const state = this.brain.getState(distance, p, opp);
      this.brain.learn(state, r);
    }

    // --- Reactive block: on harder difficulties, AI auto-blocks incoming attacks ---
    if (!p.isStunned && !p.isBlocking && !this.wantsBlock && distance < 2.2 &&
        ATTACKS[opp.currentAnimName] && Math.random() < activeDifficulty.aiBlockChance) {
      this.wantsBlock = true;
      this.blockTimer = 0.2;
      this.counterPhase = 1;
      this.counterTimer = 0.2;
    }

    // Per-frame movement: walk to the ideal distance for the queued/next attack.
    // Each animation has a specific reach — fighter positions correctly before swinging.
    if (!p.isStunned && !this.wantsBlock && !p.gameOver && !ATTACKS[p.currentAnimName]) {
      const idealDist = this.pendingAttack
        ? getIdealAttackDistance(this.pendingAttack.anim)
        : DEFAULT_FIGHT_DISTANCE;
      const err = distance - idealDist;

      if (err > DISTANCE_TOLERANCE) {
        // Too far — close the gap
        this.moveForward = 1;
        this.isSprinting = distance > 3.2;
      } else {
        // Once close enough, stop walking and let the queued strike go.
        this.moveForward = 0;
        this.isSprinting = false;
        if (this.pendingAttack && this.attackCooldown <= 0) {
          p.play(this.pendingAttack.anim, 0.05);
          this._logAction(this.pendingAttack.anim);
          this.attackCooldown = 0.28 + Math.random() * 0.18;
          this.pendingAttack = null;
        }
      }
    }

    // Decision timer: attack variety + brain learning (not movement)
    if (this.decisionTimer <= 0) {
      this.decisionTimer = this.decisionInterval;
      this._heuristic(distance);
    }

    // Attack every frame the cooldown allows when in range
    if (distance < 1.95 && !p.isStunned &&
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
        if (distance < 2.05) this._tryAttack();
        break;

      case 'attack':
        if (distance > 1.9) this.moveForward = 1;
        this._tryAttack();
        break;

      case 'block':
        this.wantsBlock = true;
        this.blockTimer = 0.25 + Math.random() * 0.15;
        break;

      case 'advance':
        this.moveForward = 1;
        this.isSprinting = distance > 3;
        if (distance < 2.1) this._tryAttack();
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
    const distance = this.player.model && this.opponent.model
      ? this.player.model.position.distanceTo(this.opponent.model.position)
      : DEFAULT_FIGHT_DISTANCE;
    this._tryAttackAtDistance(distance);
  }

  _heuristic(distance) {
    const p = this.player;
    this.wantsBlock = false;
    // Movement is driven per-frame in update() — heuristic just adds extra attack pressure
    if (distance <= 1.95 && !p.isStunned) {
      this._tryAttackAtDistance(distance);
    }
  }

  _tryAttackAtDistance(distance) {
    if (this.attackCooldown > 0 || this.player.isStunned) return;
    if (ATTACKS[this.player.currentAnimName]) return;
    if (this.combatActions.length === 0) return;
    if (this.pendingAttack) return; // already navigating to an attack

    const atk = this.combatActions[Math.floor(Math.random() * this.combatActions.length)];
    const ideal = getIdealAttackDistance(atk.anim);

    if (distance <= ideal + DISTANCE_TOLERANCE) {
      // Close enough already — don't force a fake step back before striking.
      this.player.play(atk.anim, 0.05);
      this._logAction(atk.anim);
      this.attackCooldown = 0.28 + Math.random() * 0.18;
    } else {
      // Not at ideal distance yet — queue it, movement walks to correct range first
      this.pendingAttack = atk;
    }
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

    if (ATTACKS[p.currentAnimName]) {
      this.moveForward = 0;
      this.isSprinting = false;
      this.currentMoveAnim = null;
      p.clearMovement();
      return;
    }

    // Movement — forward/backward along the line to opponent
    if (this.moveForward !== 0 && !p.isStunned && !this.wantsBlock) {
      const speed = this.isSprinting ? p.sprintSpeed : p.walkSpeed;
      const moveDir = dirToOpp.clone().multiplyScalar(this.moveForward);
      const moved = p.move(moveDir.x, moveDir.z, speed, dt, opp);

      if (!moved && this.moveForward > 0) {
        const queuedAtk = this.pendingAttack ? ATTACKS[this.pendingAttack.anim] : null;
        const canCommitQueued = this.pendingAttack && queuedAtk &&
          this.player.model.position.distanceTo(this.opponent.model.position) <= queuedAtk.range;

        if (canCommitQueued && this.attackCooldown <= 0) {
          p.play(this.pendingAttack.anim, 0.05);
          this._logAction(this.pendingAttack.anim);
          this.attackCooldown = 0.28 + Math.random() * 0.18;
          this.pendingAttack = null;
        } else if (this.attackCooldown <= 0) {
          this._tryAttackAtDistance(this.player.model.position.distanceTo(this.opponent.model.position));
        }
      }

      // Never override an active attack animation with a walk animation
      if (!ATTACKS[p.currentAnimName]) {
        let anim;
        if (this.isSprinting) anim = 'Walk_Loop';
        else if (this.moveForward > 0) anim = 'Walk_Loop';
        else anim = 'Walk_Back_Loop';

        if (this.currentMoveAnim !== anim) {
          this.currentMoveAnim = anim;
          p.play(anim, 0.12);
        }
      }
    } else if (this.moveForward === 0 && this.currentMoveAnim) {
      this.currentMoveAnim = null;
      p.clearMovement();
      // Don't force idle if an attack is still playing — let it finish naturally
      if (!p.isStunned && !this.wantsBlock && !p.isBlocking && !ATTACKS[p.currentAnimName]) {
        p.play('Idle_Loop', 0.15);
      }
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
    this.pendingAttack = null;
    this.lastHealth = this.player.maxHealth;
    this.lastOppHealth = this.opponent?.maxHealth || 100;
  }
}
