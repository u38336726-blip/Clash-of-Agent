/**
 * Headless fight simulator — runs combat logic without Three.js or DOM.
 * Multiple instances run in parallel, all feeding the same shared Brain.
 *
 * Each ghost fight is pure math: positions, health, cooldowns, Q-table lookups.
 * No models, no animations, no rendering.
 */

import { ATTACKS } from './combat.js';
import { BLOCK_ANIM } from './classes.js';
import { BRAIN_ACTIONS } from './brain.js';

// Minimal player state for headless sim
class GhostPlayer {
  constructor(id, x, classDef) {
    this.id = id;
    this.x = x;   // 1D position (fighters on a line)
    this.health = classDef.stats.maxHealth;
    this.maxHealth = classDef.stats.maxHealth;
    this.walkSpeed = classDef.stats.walkSpeed;
    this.sprintSpeed = classDef.stats.sprintSpeed;
    this.currentAnimName = 'Idle_Loop';
    this.isBlocking = false;
    this.isMoving = false;
    this.moveDir = 0;
    this.isSprinting = false;
    this.isStunned = false;
    this.stunTimer = 0;
    this.attackElapsed = 0;
    this.attackHitChecked = false;
    this.gameOver = false;
    this.startX = x;

    // Fake model position for brain state computation
    this.model = { position: { x: x, z: 0, distanceTo: (other) => Math.abs(this.x - other.x) } };
  }

  reset() {
    this.x = this.startX;
    this.health = this.maxHealth;
    this.currentAnimName = 'Idle_Loop';
    this.isBlocking = false;
    this.isMoving = false;
    this.moveDir = 0;
    this.isSprinting = false;
    this.isStunned = false;
    this.stunTimer = 0;
    this.attackElapsed = 0;
    this.attackHitChecked = false;
    this.gameOver = false;
    this.model.position.x = this.startX;
  }

  play(animName) {
    if (this.gameOver) return;
    if (this.isStunned && !['Hit_Chest','Hit_Head','Death01'].includes(animName)) return;
    this.currentAnimName = animName;
    this.isBlocking = (animName === BLOCK_ANIM);
    if (ATTACKS[animName]) {
      this.attackHitChecked = false;
      this.attackElapsed = 0;
    }
  }

  tick(dt) {
    if (ATTACKS[this.currentAnimName] && !this.attackHitChecked) {
      this.attackElapsed += dt;
    }
    if (this.isStunned && this.stunTimer > 0) {
      this.stunTimer -= dt;
      if (this.stunTimer <= 0) this.isStunned = false;
    }
  }
}

// Headless AI — mirrors AIController logic but without Three.js
class GhostAI {
  constructor(ghostPlayer, ghostOpponent, brain, combatAnims) {
    this.p = ghostPlayer;
    this.opp = ghostOpponent;
    this.brain = brain;
    this.combatAnims = combatAnims; // array of anim names

    this.attackCooldown = 0;
    this.blockTimer = 0;
    this.counterPhase = 0;
    this.counterTimer = 0;
    this.decisionTimer = 0;

    this.lastHealth = ghostPlayer.health;  // use actual starting HP (may be halved)
    this.lastOppHealth = ghostOpponent.health;
    this.tickRewardTimer = 0;
  }

  tick(dt) {
    const p = this.p;
    const opp = this.opp;
    if (p.gameOver) return;

    const distance = Math.abs(p.x - opp.x);

    this.attackCooldown -= dt;
    this.blockTimer -= dt;
    this.decisionTimer -= dt;
    this.counterTimer -= dt;
    this.tickRewardTimer -= dt;

    // Counter combo
    if (this.counterPhase === 1 && this.counterTimer <= 0) {
      this.counterPhase = 2;
      this.counterTimer = 0.15;
      p.isBlocking = false;
      p.currentAnimName = 'Idle_Loop';
    }
    if (this.counterPhase === 2 && this.counterTimer <= 0) {
      this.counterPhase = 0;
      this._attack();
    }

    // Reward shaping
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
      if (distance < 2.5 && p.currentAnimName === 'Idle_Loop' && !p.isStunned) r -= 3.0;
      if (distance < 2.0 && ATTACKS[p.currentAnimName]) r += 1.0;

      this.lastHealth = p.health;
      this.lastOppHealth = opp.health;

      const state = this.brain.getState(distance, p, opp);
      this.brain.learn(state, r);
    }

    // Decision
    if (this.decisionTimer <= 0 && this.counterPhase === 0) {
      this.decisionTimer = 0.1;
      const state = this.brain.getState(distance, p, opp);
      const actionIdx = this.brain.chooseAction(state);
      this.brain.remember(state, actionIdx);
      this._execute(actionIdx, distance);
    }

    // Movement — forward/backward only along the line between fighters
    if (p.moveDir !== 0 && !p.isStunned && !p.isBlocking) {
      const towardOpp = opp.x > p.x ? 1 : -1;
      const speed = p.isSprinting ? p.sprintSpeed : p.walkSpeed;
      const newX = p.x + towardOpp * p.moveDir * speed * dt;
      // Tight arena + don't walk through opponent
      if (Math.abs(newX - opp.x) > 0.5) {
        p.x = Math.max(-2, Math.min(2, newX));
        p.model.position.x = p.x;
      }
      p.isMoving = (p.moveDir !== 0);
    } else {
      p.isMoving = false;
    }

    // Block expire
    if (p.isBlocking && this.blockTimer <= 0) {
      p.isBlocking = false;
      p.currentAnimName = 'Idle_Loop';
    }
  }

  _execute(actionIdx, distance) {
    const p = this.p;
    const action = BRAIN_ACTIONS[actionIdx];

    p.moveDir = 0;  // 1=forward(toward opp), -1=back, 0=stand
    p.isSprinting = false;
    p.isBlocking = false;

    switch (action) {
      case 'rush_attack':
        p.moveDir = 1;
        p.isSprinting = true;
        if (distance < 2.2) this._attack();
        break;
      case 'attack':
        if (distance > 2.0) p.moveDir = 1;
        this._attack();
        break;
      case 'block':
        p.isBlocking = true;
        p.currentAnimName = BLOCK_ANIM;
        this.blockTimer = 0.25;
        break;
      case 'advance':
        p.moveDir = 1;
        p.isSprinting = distance > 3;
        break;
      case 'roll':
        p.moveDir = 1;
        p.currentAnimName = 'Roll';
        this.attackCooldown = 0.3;
        break;
      case 'counter':
        p.isBlocking = true;
        p.currentAnimName = BLOCK_ANIM;
        this.blockTimer = 0.2;
        this.counterPhase = 1;
        this.counterTimer = 0.2;
        break;
      case 'retreat':
        p.moveDir = -1;
        break;
    }
  }

  _attack() {
    const p = this.p;
    if (this.attackCooldown > 0 || p.isStunned || ATTACKS[p.currentAnimName]) return;
    if (this.combatAnims.length === 0) return;
    const anim = this.combatAnims[Math.floor(Math.random() * this.combatAnims.length)];
    p.play(anim);
    this.attackCooldown = 0.15 + Math.random() * 0.1; // very fast chaining
  }

  reset() {
    this.attackCooldown = 0;
    this.blockTimer = 0;
    this.counterPhase = 0;
    this.counterTimer = 0;
    this.decisionTimer = 0;
    this.tickRewardTimer = 0;
    this.lastHealth = this.p.maxHealth;
    this.lastOppHealth = this.opp.maxHealth;
  }
}

// Headless hit check — calibrated to match real 3D game hit rates (~65-80%)
function ghostHitCheck(attacker, victim) {
  const atk = ATTACKS[attacker.currentAnimName];
  if (!atk || attacker.attackHitChecked) return null;
  if (attacker.attackElapsed < atk.hitTime) return null;
  if (attacker.attackElapsed > atk.hitTime + (atk.hitWindow ?? 0.14)) {
    attacker.attackHitChecked = true;
    return null;
  }

  const dist = Math.abs(attacker.x - victim.x);
  if (dist > atk.range) return null;

  // Roll = full dodge (but rare)
  if (victim.currentAnimName === 'Roll') return null;

  // Blocking
  if (victim.isBlocking) {
    const reduction = atk.type === 'melee' ? 0.8 : 0.6;
    return { damage: Math.round(atk.damage * (1 - reduction)), blocked: true };
  }

  // Moving dodge — much lower rates to match real game
  // In real 3D, melee barely misses moving targets at close range
  if (victim.isMoving && dist > 1.5) {
    const dodgeChance = atk.type === 'ranged' ? 0.25 : 0.05;
    if (Math.random() < dodgeChance) return { dodged: true };
  }

  attacker.attackHitChecked = true;
  return { damage: atk.damage, reaction: atk.reaction };
}

/**
 * Run a single headless fight to completion.
 * Returns { winner: 'p1'|'p2', ticks }
 */
function runGhostFight(brain1, brain2, classDef1, classDef2, combatAnims1, combatAnims2) {
  // Start in face, halved HP so fights are decisive (learn from KOs, not timeouts)
  const p1 = new GhostPlayer('p1', -0.7, classDef1);
  const p2 = new GhostPlayer('p2', 0.7, classDef2);
  p1.health = Math.round(p1.maxHealth * 0.5);
  p2.health = Math.round(p2.maxHealth * 0.5);
  const ai1 = new GhostAI(p1, p2, brain1, combatAnims1);
  const ai2 = new GhostAI(p2, p1, brain2, combatAnims2);

  const dt = 0.05;
  const maxTicks = 600; // 30 seconds max — force decisive fights
  let ticks = 0;

  const events = [];
  let p1Dmg = 0, p2Dmg = 0, p1Hits = 0, p2Hits = 0, blocks = 0, dodges = 0;

  while (ticks < maxTicks && !p1.gameOver && !p2.gameOver) {
    ticks++;
    ai1.tick(dt);
    ai2.tick(dt);
    p1.tick(dt);
    p2.tick(dt);

    for (const [attacker, victim] of [[p1, p2], [p2, p1]]) {
      const result = ghostHitCheck(attacker, victim);
      if (!result) continue;

      const dist = Math.abs(attacker.x - victim.x);
      const evt = {
        tick: ticks,
        attacker: attacker.id,
        action: attacker.currentAnimName,
        p1_hp: +p1.health.toFixed(1),
        p2_hp: +p2.health.toFixed(1),
        distance: +dist.toFixed(2),
      };

      if (result.dodged) {
        dodges++;
        evt.result = 'dodged';
        events.push(evt);
        continue;
      }

      const wasBlocked = !!result.blocked;
      victim.health = Math.max(0, victim.health - result.damage);
      evt.damage = result.damage;

      if (wasBlocked) {
        blocks++;
        evt.result = 'blocked';
      } else {
        evt.result = 'hit';
        if (attacker.id === 'p1') { p1Dmg += result.damage; p1Hits++; }
        else { p2Dmg += result.damage; p2Hits++; }
      }
      events.push(evt);

      if (victim.health <= 0) {
        victim.gameOver = true;
        events.push({ tick: ticks, event: 'ko', winner: attacker.id, p1_hp: +p1.health.toFixed(1), p2_hp: +p2.health.toFixed(1) });
        break;
      }
      if (!wasBlocked) {
        victim.isStunned = true;
        victim.stunTimer = 0.25; // shorter stun = faster fights
        victim.currentAnimName = 'Hit_Chest';
      }
    }

    // Expire attack anims fast so attacks can chain (0.4s = hitTime + small buffer)
    if (ATTACKS[p1.currentAnimName] && p1.attackElapsed > 0.4) p1.currentAnimName = 'Idle_Loop';
    if (ATTACKS[p2.currentAnimName] && p2.attackElapsed > 0.4) p2.currentAnimName = 'Idle_Loop';
  }

  const timedOut = !p1.gameOver && !p2.gameOver;
  const winner = p2.gameOver ? 'p1' : p1.gameOver ? 'p2' : (p1.health > p2.health ? 'p1' : 'p2');

  // Timeout punishment — both brains learn that stalling is terrible
  if (timedOut) {
    const penalty = -30;
    brain1.learn(brain1.lastState || '0_2_2_0_0_0', penalty);
    brain2.learn(brain2.lastState || '0_2_2_0_0_0', penalty);
    events.push({ tick: ticks, event: 'timeout', p1_hp: +p1.health.toFixed(1), p2_hp: +p2.health.toFixed(1) });
  }

  return {
    winner, ticks, timedOut, events,
    stats: { p1Dmg, p2Dmg, p1Hits, p2Hits, blocks, dodges }
  };
}

/**
 * Run N ghost fights in parallel using shared brains.
 * Called from main thread — runs synchronously in batches.
 */
// Accumulated ghost logs — stored between exports
let ghostLog = [];
const MAX_GHOST_LOG = 10000;

export function runGhostBatch(brain1, brain2, classDef1, classDef2, combatAnims1, combatAnims2, count = 10) {
  let p1Wins = 0;
  let batchStats = { totalHits: 0, totalBlocks: 0, totalDodges: 0, totalP1Dmg: 0, totalP2Dmg: 0 };

  for (let i = 0; i < count; i++) {
    const result = runGhostFight(brain1, brain2, classDef1, classDef2, combatAnims1, combatAnims2);
    const won1 = result.winner === 'p1';

    brain1.learn(brain1.lastState || '0_2_2_0_0_0', won1 ? 50 : -50);
    brain2.learn(brain2.lastState || '0_2_2_0_0_0', won1 ? -50 : 50);
    brain1.endRound(won1, result.ticks);
    brain2.endRound(!won1, result.ticks);

    if (won1) p1Wins++;

    // Accumulate stats
    batchStats.totalHits += result.stats.p1Hits + result.stats.p2Hits;
    batchStats.totalBlocks += result.stats.blocks;
    batchStats.totalDodges += result.stats.dodges;
    batchStats.totalP1Dmg += result.stats.p1Dmg;
    batchStats.totalP2Dmg += result.stats.p2Dmg;

    // Store compact summary per ghost fight (not every event — too much data)
    ghostLog.push({
      round: brain1.rounds,
      winner: result.winner,
      ticks: result.ticks,
      p1Dmg: result.stats.p1Dmg,
      p2Dmg: result.stats.p2Dmg,
      p1Hits: result.stats.p1Hits,
      p2Hits: result.stats.p2Hits,
      blocks: result.stats.blocks,
      dodges: result.stats.dodges,
      p1FinalHp: result.events.length > 0 ? result.events[result.events.length - 1].p1_hp : 0,
      p2FinalHp: result.events.length > 0 ? result.events[result.events.length - 1].p2_hp : 0,
    });
  }

  // Trim log to prevent memory bloat
  if (ghostLog.length > MAX_GHOST_LOG) {
    ghostLog = ghostLog.slice(-MAX_GHOST_LOG);
  }

  return { p1Wins, p2Wins: count - p1Wins, batchStats };
}

/** Get all accumulated ghost fight summaries for export */
export function getGhostLog() {
  return ghostLog;
}

/** Clear ghost log */
export function clearGhostLog() {
  ghostLog = [];
}
