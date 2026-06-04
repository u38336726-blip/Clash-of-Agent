import * as THREE from 'three';
import { ATTACKS } from './combat.js';
import { BLOCK_ANIM } from './classes.js';
import { Brain, BRAIN_ACTIONS, initBrainCombatRef } from './brain.js';
import { activeDifficulty } from './difficulty.js';

initBrainCombatRef(ATTACKS);

const DEFAULT_FIGHT_DISTANCE = 1.56; // matches PLAYER_COLLISION_DIST — fighters stand at contact range
const DISTANCE_TOLERANCE = 0.25;    // wide enough to fire at collision boundary for all idealDist values
const ATTACK_COOLDOWN_BY_TYPE = {
  melee: 0.34,
  kick: 0.44,
};
const EXTRA_HEAVY_ATTACK_DELAY = new Set(['Elbow', 'Counter', 'Uppercut', 'Uppercut_Combo']);
const BLOCKED_ADVANCE_TIMEOUT = 0.18;
const STAGNATION_DISTANCE_EPS = 0.035;
const STAGNATION_TIMEOUT = 0.55;
const ENGAGEMENT_STALL_DISTANCE_EPS = 0.08;
const ENGAGEMENT_STALL_TIMEOUT = 1.1;
const PUNCH_PREFERENCE_RANGE = 1.72;
const CLOSE_PRESSURE_RANGE = 1.92;
const CLOSE_PRESSURE_TIMEOUT = 0.42;
const PENDING_ATTACK_LOOP_RANGE = 2.18;
const PENDING_ATTACK_TIMEOUT = 0.6;
const PASSIVE_DECISION_STREAK_LIMIT = 3;
const PASSIVE_DECISIONS = new Set(['block', 'retreat']);

function getIdealAttackDistance(animName) {
  return ATTACKS[animName]?.idealDist ?? DEFAULT_FIGHT_DISTANCE;
}

function isWithinCommitDistance(animName, distance) {
  const atk = ATTACKS[animName];
  if (!atk) return distance <= DEFAULT_FIGHT_DISTANCE + DISTANCE_TOLERANCE;
  return distance <= atk.range || distance <= getIdealAttackDistance(animName) + DISTANCE_TOLERANCE;
}

function canUseAttackAtDistance(animName, distance) {
  const atk = ATTACKS[animName];
  if (!atk) return false;
  return isWithinCommitDistance(animName, distance);
}

function isPassiveDecision(action) {
  return PASSIVE_DECISIONS.has(action);
}

function getAttackCooldown(animName, paceMultiplier = 1) {
  const atk = ATTACKS[animName];
  if (!atk) return (0.34 + Math.random() * 0.08) * paceMultiplier;

  let cooldown = ATTACK_COOLDOWN_BY_TYPE[atk.type] ?? 0.34;
  if ((atk.damage ?? 0) >= 18) cooldown += 0.04;
  if (EXTRA_HEAVY_ATTACK_DELAY.has(animName)) cooldown += 0.04;
  return (cooldown + Math.random() * 0.08) * paceMultiplier;
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
    this.attackPaceMultiplier = 1;
    this.isSprinting = false;
    this.moveForward = 0; // 1=toward opp, -1=away, 0=stand
    this.currentMoveAnim = null;
    this.blockedAdvanceTime = 0;
    this.stagnationTime = 0;
    this.closePressureTime = 0;
    this.engagementStallTime = 0;

    this.wantsBlock = false;
    this.blockTimer = 0;
    this.counterPhase = 0;
    this.counterTimer = 0;
    this.pendingAttack = null; // attack queued, waiting to reach ideal distance
    this.pendingAttackTime = 0;
    this.lastPendingAttackAnim = null;

    this.brain = useBrain ? new Brain(player.id) : null;

    this.lastHealth = player.maxHealth;
    this.lastOppHealth = opponent.maxHealth || 100;
    this.tickRewardTimer = 0;
    this.lastProgressDistance = null;
    this.lastProgressSelfHealth = player.maxHealth;
    this.lastProgressOppHealth = opponent.maxHealth || 100;
    this.lastAttackAnim = null;
    this.lastAttackType = null;
    this.sameTypeStreak = 0;
    this.lastOppAttackAnim = null;
    this.lastOppAttackElapsed = 0;
    this.reactedToOppAttack = false;
    this.lastEngagementDistance = null;
    this.lastEngagementSelfHealth = player.maxHealth;
    this.lastEngagementOppHealth = opponent.maxHealth || 100;
    this.lastDecisionAction = null;
    this.sameDecisionStreak = 0;

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

    this._trackStagnation(distance, dt);
    this._trackPendingAttack(distance, dt);

    this._trackOpponentAttack(opp);
    this._trackClosePressure(distance, dt);
    this._trackEngagementStall(distance, dt);

    // --- Reactive block: check once per opponent attack, not every frame of the attack ---
    if (!p.isStunned && !p.isBlocking && !this.wantsBlock && distance < 2.2 &&
        ATTACKS[opp.currentAnimName] && !this.reactedToOppAttack &&
        Math.random() < activeDifficulty.aiBlockChance) {
      this.wantsBlock = true;
      this.blockTimer = 0.2;
      this.counterPhase = 1;
      this.counterTimer = 0.2;
      this.reactedToOppAttack = true;
    }

    if (this.pendingAttackTime >= PENDING_ATTACK_TIMEOUT &&
        this.attackCooldown <= 0 && !p.isStunned && !this.wantsBlock && !ATTACKS[p.currentAnimName]) {
      this._breakPendingAttackLoop(distance);
    }

    // Per-frame movement: walk to the ideal distance for the queued/next attack.
    // Each animation has a specific reach — fighter positions correctly before swinging.
    if (!p.isStunned && !this.wantsBlock && !p.gameOver && !ATTACKS[p.currentAnimName]) {
      const pendingAnim = this.pendingAttack?.anim ?? null;
      if (pendingAnim && this.attackCooldown <= 0 && isWithinCommitDistance(pendingAnim, distance)) {
        this.moveForward = 0;
        this.isSprinting = false;
        this._playAttack(pendingAnim);
        this.pendingAttack = null;
      } else {
        const idealDist = pendingAnim
          ? getIdealAttackDistance(pendingAnim)
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
            this._playAttack(this.pendingAttack.anim);
            this.pendingAttack = null;
          }
        }
      }
    }

    // Decision timer: let the learned brain drive visible choices in train mode.
    if (this.decisionTimer <= 0) {
      this.decisionTimer = this.decisionInterval;
      if (this.useBrain && this.brain) {
        const state = this.brain.getState(distance, p, opp);
        const actionIdx = this.brain.chooseAction(state);
        this.brain.remember(state, actionIdx);
        this._execute(actionIdx, distance);
      } else {
        this._heuristic(distance);
      }
    }

    if (this.closePressureTime >= CLOSE_PRESSURE_TIMEOUT &&
        this.attackCooldown <= 0 && !p.isStunned && !ATTACKS[p.currentAnimName]) {
      this._forceInitiative(distance);
    }

    if (this.engagementStallTime >= ENGAGEMENT_STALL_TIMEOUT &&
        this.attackCooldown <= 0 && !p.isStunned && !ATTACKS[p.currentAnimName]) {
      this._forceInitiative(distance);
    }

    // Attack every frame the cooldown allows when in range
    if (distance < 1.95 && !p.isStunned &&
        this.attackCooldown <= 0 && !ATTACKS[p.currentAnimName]) {
      this._tryAttackAtDistance(distance);
    }

    if (this.stagnationTime >= STAGNATION_TIMEOUT &&
        this.attackCooldown <= 0 && !p.isStunned && !ATTACKS[p.currentAnimName]) {
      this._breakStall(distance);
    }

    // --- Apply movement (forward/backward only) ---
    this._applyMovement(dt, dirToOpp, opp);
  }

  _execute(actionIdx, distance) {
    const p = this.player;
    const action = BRAIN_ACTIONS[actionIdx];
    const oppThreatening = Boolean(ATTACKS[this.opponent.currentAnimName]);

    this._recordDecision(action);

    if (distance <= CLOSE_PRESSURE_RANGE && !oppThreatening &&
        (action === 'block' || action === 'retreat')) {
      this._forceInitiative(distance);
      return;
    }

    if (distance <= 2.3 && !oppThreatening &&
        isPassiveDecision(action) && this.sameDecisionStreak >= PASSIVE_DECISION_STREAK_LIMIT) {
      this._forceInitiative(distance);
      return;
    }

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

    const atk = this._pickAttack(distance, this.combatActions);
    if (!atk) return;
    if (isWithinCommitDistance(atk.anim, distance)) {
      // Close enough already — don't force a fake step back before striking.
      this._playAttack(atk.anim);
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
      this.blockedAdvanceTime = 0;
      p.clearMovement();
      return;
    }

    // Movement — forward/backward along the line to opponent
    if (this.moveForward !== 0 && !p.isStunned && !this.wantsBlock) {
      const speed = this.isSprinting ? p.sprintSpeed : p.walkSpeed;
      const moveDir = dirToOpp.clone().multiplyScalar(this.moveForward);
      const moved = p.move(moveDir.x, moveDir.z, speed, dt, opp);

      if (!moved && this.moveForward > 0) {
        this.blockedAdvanceTime += dt;
        const distanceNow = this.player.model.position.distanceTo(this.opponent.model.position);
        const canCommitQueued = this.pendingAttack &&
          isWithinCommitDistance(this.pendingAttack.anim, distanceNow);

        if (canCommitQueued && this.attackCooldown <= 0) {
          this._playAttack(this.pendingAttack.anim);
          this.pendingAttack = null;
          this.blockedAdvanceTime = 0;
        } else if (this.attackCooldown <= 0) {
          const fallbackAttack = this._getReachableAttack(distanceNow);
          if (fallbackAttack && this.blockedAdvanceTime >= BLOCKED_ADVANCE_TIMEOUT) {
            this.pendingAttack = null;
            this.currentMoveAnim = null;
            this.blockedAdvanceTime = 0;
            p.clearMovement();
            this._playAttack(fallbackAttack.anim);
            return;
          }
          this._tryAttackAtDistance(distanceNow);

          if (this.pendingAttack && this.blockedAdvanceTime >= BLOCKED_ADVANCE_TIMEOUT) {
            const replacementAttack = this._getReachableAttack(distanceNow, this.pendingAttack.anim);
            if (replacementAttack) {
              this.pendingAttack = replacementAttack;
              this.currentMoveAnim = null;
              this.blockedAdvanceTime = 0;
              p.clearMovement();
              this._playAttack(replacementAttack.anim);
              return;
            }

            this.pendingAttack = null;
            this.moveForward = 0;
            this.currentMoveAnim = null;
            this.blockedAdvanceTime = 0;
            p.clearMovement();
            return;
          }
        }
      } else if (moved) {
        this.blockedAdvanceTime = 0;
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
      this.blockedAdvanceTime = 0;
      p.clearMovement();
      // Don't force idle if an attack is still playing — let it finish naturally
      if (!p.isStunned && !this.wantsBlock && !p.isBlocking && !ATTACKS[p.currentAnimName]) {
        p.play('Idle_Loop', 0.15);
      }
    } else if (this.moveForward === 0) {
      this.blockedAdvanceTime = 0;
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

  _playAttack(animName) {
    const attackType = ATTACKS[animName]?.type ?? 'melee';
    this.player.play(animName, 0.05);
    this._logAction(animName);
    this.attackCooldown = getAttackCooldown(animName, this.attackPaceMultiplier);
    this.pendingAttack = null;
    this.pendingAttackTime = 0;
    this.lastPendingAttackAnim = null;
    this.lastAttackAnim = animName;
    if (this.lastAttackType === attackType) this.sameTypeStreak += 1;
    else this.sameTypeStreak = 1;
    this.lastAttackType = attackType;
    this.stagnationTime = 0;
    this.closePressureTime = 0;
    this.engagementStallTime = 0;
  }

  _getReachableAttack(distance, preferredAnim = null) {
    if (preferredAnim && canUseAttackAtDistance(preferredAnim, distance)) {
      const preferredAction = this.combatActions.find(action => action.anim === preferredAnim);
      if (preferredAction) return preferredAction;
    }

    const reachable = this.combatActions.filter(action => canUseAttackAtDistance(action.anim, distance));
    if (reachable.length === 0) return null;

    return this._pickAttack(distance, reachable, preferredAnim);
  }

  _pickAttack(distance, pool, preferredAnim = null) {
    if (!pool || pool.length === 0) return null;

    let best = null;
    let bestScore = -Infinity;
    for (const action of pool) {
      const score = this._scoreAttack(action, distance, preferredAnim);
      if (score > bestScore) {
        bestScore = score;
        best = action;
      }
    }
    return best;
  }

  _scoreAttack(action, distance, preferredAnim = null) {
    const atk = ATTACKS[action.anim];
    if (!atk) return -Infinity;

    const isKick = atk.type === 'kick';
    const ideal = getIdealAttackDistance(action.anim);
    let score = -Math.abs(distance - ideal) * 2.5;

    if (action.anim === preferredAnim) score += 0.35;
    if (isKick) score -= 0.45;
    else score += 0.65;

    if (distance <= PUNCH_PREFERENCE_RANGE) {
      score += isKick ? -0.8 : 1.0;
    } else if (distance >= 1.82) {
      score += isKick ? 0.45 : -0.15;
    }

    if (this.lastAttackAnim === action.anim) score -= 0.3;
    if (this.lastAttackType === atk.type) {
      score -= (isKick ? 0.42 : 0.18) * Math.max(0, this.sameTypeStreak - 1);
    }

    score += Math.random() * 0.18;
    return score;
  }

  _trackStagnation(distance, dt) {
    const p = this.player;
    const opp = this.opponent;
    const distanceStable = this.lastProgressDistance !== null &&
      Math.abs(distance - this.lastProgressDistance) <= STAGNATION_DISTANCE_EPS;
    const healthStable = p.health === this.lastProgressSelfHealth &&
      opp.health === this.lastProgressOppHealth;
    const canStagnate = distance < 2.12 &&
      !p.isStunned &&
      !opp.isStunned &&
      !ATTACKS[p.currentAnimName] &&
      !ATTACKS[opp.currentAnimName] &&
      !p.isBlocking &&
      !opp.isBlocking &&
      !this.wantsBlock;

    if (canStagnate && distanceStable && healthStable) this.stagnationTime += dt;
    else this.stagnationTime = 0;

    this.lastProgressDistance = distance;
    this.lastProgressSelfHealth = p.health;
    this.lastProgressOppHealth = opp.health;
  }

  _trackClosePressure(distance, dt) {
    const p = this.player;
    const opp = this.opponent;
    const oppThreatening = Boolean(ATTACKS[opp.currentAnimName]);
    const holdingDefense = p.isBlocking || this.wantsBlock;
    const canPressure = distance <= CLOSE_PRESSURE_RANGE &&
      !p.isStunned &&
      !opp.isStunned &&
      !ATTACKS[p.currentAnimName] &&
      this.counterPhase === 0 &&
      (!holdingDefense || !oppThreatening);

    if (canPressure) this.closePressureTime += dt;
    else this.closePressureTime = 0;
  }

  _trackPendingAttack(distance, dt) {
    const pendingAnim = this.pendingAttack?.anim ?? null;
    if (pendingAnim !== this.lastPendingAttackAnim) {
      this.pendingAttackTime = 0;
      this.lastPendingAttackAnim = pendingAnim;
    }

    const canTrack = pendingAnim &&
      distance <= PENDING_ATTACK_LOOP_RANGE &&
      !this.player.isStunned &&
      !this.player.gameOver &&
      !this.wantsBlock &&
      !ATTACKS[this.player.currentAnimName];

    if (canTrack) this.pendingAttackTime += dt;
    else this.pendingAttackTime = 0;
  }

  _trackEngagementStall(distance, dt) {
    const p = this.player;
    const opp = this.opponent;
    const distanceStable = this.lastEngagementDistance !== null &&
      Math.abs(distance - this.lastEngagementDistance) <= ENGAGEMENT_STALL_DISTANCE_EPS;
    const healthStable = p.health === this.lastEngagementSelfHealth &&
      opp.health === this.lastEngagementOppHealth;
    const canStall = distance <= 2.3 &&
      !p.isStunned &&
      !opp.isStunned &&
      !p.gameOver &&
      !opp.gameOver;

    if (canStall && distanceStable && healthStable) this.engagementStallTime += dt;
    else this.engagementStallTime = 0;

    this.lastEngagementDistance = distance;
    this.lastEngagementSelfHealth = p.health;
    this.lastEngagementOppHealth = opp.health;
  }

  _trackOpponentAttack(opponent) {
    const oppAtk = ATTACKS[opponent.currentAnimName];
    if (!oppAtk) {
      this.lastOppAttackAnim = null;
      this.lastOppAttackElapsed = 0;
      this.reactedToOppAttack = false;
      return;
    }

    const newAttackStarted =
      this.lastOppAttackAnim !== opponent.currentAnimName ||
      opponent.attackElapsed + 0.0001 < this.lastOppAttackElapsed;

    if (newAttackStarted) {
      this.reactedToOppAttack = false;
    }

    this.lastOppAttackAnim = opponent.currentAnimName;
    this.lastOppAttackElapsed = opponent.attackElapsed;
  }

  _breakStall(distance) {
    const breakerAttack = this._getReachableAttack(distance);

    this.pendingAttack = null;
    this.currentMoveAnim = null;
    this.blockedAdvanceTime = 0;
    this.stagnationTime = 0;
    this.player.clearMovement();

    if (breakerAttack) {
      this.moveForward = 0;
      this._playAttack(breakerAttack.anim);
      return;
    }

    this.moveForward = -1;
    this.isSprinting = false;
  }

  _breakPendingAttackLoop(distance) {
    const preferredAnim = this.pendingAttack?.anim ?? null;
    const fallbackAttack = preferredAnim
      ? this._getReachableAttack(distance, preferredAnim)
      : this._getReachableAttack(distance);

    this.pendingAttack = null;
    this.pendingAttackTime = 0;
    this.lastPendingAttackAnim = null;
    this.currentMoveAnim = null;
    this.blockedAdvanceTime = 0;
    this.stagnationTime = 0;
    this.closePressureTime = 0;
    this.engagementStallTime = 0;
    this.player.clearMovement();

    if (fallbackAttack) {
      this.moveForward = 0;
      this.isSprinting = false;
      this._playAttack(fallbackAttack.anim);
      return;
    }

    this._forceInitiative(distance);
  }

  _forceInitiative(distance) {
    const p = this.player;
    const fallbackAttack = this._getReachableAttack(distance) || this._pickAttack(distance, this.combatActions);

    this.wantsBlock = false;
    this.blockTimer = 0;
    this.pendingAttack = null;
    this.pendingAttackTime = 0;
    this.lastPendingAttackAnim = null;
    this.currentMoveAnim = null;
    this.blockedAdvanceTime = 0;
    this.stagnationTime = 0;
    this.closePressureTime = 0;
    this.engagementStallTime = 0;
    p.clearMovement();

    if (p.isBlocking) {
      p.play('Idle_Loop', 0.05);
    }

    if (!fallbackAttack) {
      this.moveForward = 1;
      this.isSprinting = false;
      return;
    }

    if (isWithinCommitDistance(fallbackAttack.anim, distance)) {
      this.moveForward = 0;
      this.isSprinting = false;
      this._playAttack(fallbackAttack.anim);
      return;
    }

    this.pendingAttack = fallbackAttack;
    this.moveForward = 1;
    this.isSprinting = false;
  }

  _recordDecision(action) {
    if (this.lastDecisionAction === action) this.sameDecisionStreak += 1;
    else this.sameDecisionStreak = 1;
    this.lastDecisionAction = action;
  }

  reset() {
    this.decisionTimer = 0;
    this.attackCooldown = 0;
    this.moveForward = 0;
    this.currentMoveAnim = null;
    this.blockedAdvanceTime = 0;
    this.stagnationTime = 0;
    this.closePressureTime = 0;
    this.engagementStallTime = 0;
    this.wantsBlock = false;
    this.blockTimer = 0;
    this.counterPhase = 0;
    this.counterTimer = 0;
    this.tickRewardTimer = 0;
    this.pendingAttack = null;
    this.pendingAttackTime = 0;
    this.lastPendingAttackAnim = null;
    this.lastHealth = this.player.maxHealth;
    this.lastOppHealth = this.opponent?.maxHealth || 100;
    this.lastProgressDistance = null;
    this.lastProgressSelfHealth = this.player.maxHealth;
    this.lastProgressOppHealth = this.opponent?.maxHealth || 100;
    this.lastAttackAnim = null;
    this.lastAttackType = null;
    this.sameTypeStreak = 0;
    this.lastOppAttackAnim = null;
    this.lastOppAttackElapsed = 0;
    this.reactedToOppAttack = false;
    this.lastEngagementDistance = null;
    this.lastEngagementSelfHealth = this.player.maxHealth;
    this.lastEngagementOppHealth = this.opponent?.maxHealth || 100;
    this.lastDecisionAction = null;
    this.sameDecisionStreak = 0;
  }
}
