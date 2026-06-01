/**
 * Q-learning brain v2 — redesigned from human match analysis.
 *
 * Key failures in v1:
 * 1. AI stood idle 44% of the time when getting hit
 * 2. Only blocked 17% vs human's 35%
 * 3. Attacked 25% slower than human
 * 4. State space missed critical combat context
 * 5. Only landed hits on stunned opponents (no initiative)
 *
 * Fixes:
 * - Finer state: includes "am I mid-attack?", "am I stunned?", "am I idle?"
 * - Faster action cycle: punish idle heavily, reward attack chains
 * - Reactive blocking: separate fast-path for "opponent winding up"
 * - Reward hitting non-stunned opponents more (creating openings)
 * - Punish getting hit while idle (should have been blocking or attacking)
 */

export const BRAIN_ACTIONS = [
  'rush_attack',   // 0 - sprint forward + attack
  'attack',        // 1 - attack now
  'block',         // 2 - block
  'advance',       // 3 - walk toward opponent
  'roll',          // 4 - dodge roll forward
  'counter',       // 5 - block then counter-attack
  'retreat',       // 6 - step back briefly
];

export class Brain {
  constructor(id, learningRate = 0.4, discount = 0.92, epsilon = 0.15) {
    this.id = id;
    this.lr = learningRate;
    this.discount = discount;
    this.epsilon = epsilon;
    this.minEpsilon = 0.03;
    this.epsilonDecay = 0.994;

    this.q = {};

    // Stats
    this.totalReward = 0;
    this.roundReward = 0;
    this.wins = 0;
    this.losses = 0;
    this.rounds = 0;
    this.rewardHistory = [];
    this.winRateHistory = [];
    this.rollingWinRate = [];
    this.damageDealtHistory = [];
    this.avgDmgDealtHistory = [];
    this.roundDamageDealt = 0;
    this.roundLengths = [];

    this.lastState = null;
    this.lastAction = null;

    this.replayBuffer = [];
    this.maxReplay = 1000;
  }

  /**
   * State encoding — 6 dimensions for richer situational awareness.
   * Format: dist_myHp_oppHp_oppAction_myAction_oppBlocking
   *
   * dist:       0=close(<1.5) 1=mid(1.5-2.5) 2=far(>2.5)
   * myHp:       0=low(<30%) 1=mid(30-60%) 2=high(>60%)
   * oppHp:      same
   * oppAction:  0=idle 1=attacking 2=stunned 3=moving
   * myAction:   0=idle 1=attacking 2=blocking 3=stunned
   * oppBlock:   0=not blocking 1=blocking
   */
  getState(distance, player, opponent) {
    const distBin = distance < 1.5 ? 0 : distance < 2.5 ? 1 : 2;

    const myHpPct = player.health / player.maxHealth;
    const myHpBin = myHpPct < 0.3 ? 0 : myHpPct < 0.6 ? 1 : 2;

    const oppHpPct = opponent.health / opponent.maxHealth;
    const oppHpBin = oppHpPct < 0.3 ? 0 : oppHpPct < 0.6 ? 1 : 2;

    // What is opponent doing?
    let oppAction = 0; // idle
    if (opponent.isStunned) oppAction = 2;
    else if (opponent.isMoving) oppAction = 3;
    else if (_isAttacking(opponent)) oppAction = 1;

    // What am I doing?
    let myAction = 0; // idle
    if (player.isStunned) myAction = 3;
    else if (player.isBlocking) myAction = 2;
    else if (_isAttacking(player)) myAction = 1;

    const oppBlock = opponent.isBlocking ? 1 : 0;

    return `${distBin}_${myHpBin}_${oppHpBin}_${oppAction}_${myAction}_${oppBlock}`;
  }

  getQ(state) {
    if (!this.q[state]) {
      // Aggressive initial bias
      const q = new Float32Array(BRAIN_ACTIONS.length);
      q[0] = 2.0;  // rush_attack
      q[1] = 3.0;  // attack — strongest by far
      q[2] = -1.0; // block — DISCOURAGED, only learn it reactively
      q[3] = 1.0;  // advance
      q[4] = 0.3;  // roll
      q[5] = 1.5;  // counter (block+attack combo, better than pure block)
      q[6] = -1.0; // retreat — discouraged
      this.q[state] = q;
    }
    return this.q[state];
  }

  chooseAction(state) {
    if (Math.random() < this.epsilon) {
      // Weighted exploration — still biased toward combat
      // rush_atk, attack, block, advance, roll, counter, retreat
      const weights = [3, 4, 2, 1, 1, 2, 0.5];
      const total = weights.reduce((a, b) => a + b);
      let r = Math.random() * total;
      for (let i = 0; i < weights.length; i++) {
        r -= weights[i];
        if (r <= 0) return i;
      }
      return 1;
    }
    const qvals = this.getQ(state);
    let best = 0, bestVal = qvals[0];
    for (let i = 1; i < qvals.length; i++) {
      if (qvals[i] > bestVal) { best = i; bestVal = qvals[i]; }
    }
    return best;
  }

  learn(newState, reward) {
    if (this.lastState === null) return;
    const oldQ = this.getQ(this.lastState);
    const newQ = this.getQ(newState);
    const maxFutureQ = Math.max(...newQ);
    oldQ[this.lastAction] +=
      this.lr * (reward + this.discount * maxFutureQ - oldQ[this.lastAction]);

    this.replayBuffer.push({ s: this.lastState, a: this.lastAction, r: reward, s2: newState });
    if (this.replayBuffer.length > this.maxReplay) this.replayBuffer.shift();

    this.totalReward += reward;
    this.roundReward += reward;
  }

  remember(state, action) {
    this.lastState = state;
    this.lastAction = action;
  }

  replay(batchSize = 50) {
    const buf = this.replayBuffer;
    if (buf.length < 10) return;
    const n = Math.min(batchSize, buf.length);
    for (let i = 0; i < n; i++) {
      const exp = buf[Math.floor(Math.random() * buf.length)];
      const oldQ = this.getQ(exp.s);
      const newQ = this.getQ(exp.s2);
      const maxFutureQ = Math.max(...newQ);
      oldQ[exp.a] += this.lr * 0.5 * (exp.r + this.discount * maxFutureQ - oldQ[exp.a]);
    }
  }

  endRound(won, roundTicks = 0) {
    this.rounds++;
    if (won) this.wins++; else this.losses++;
    this.rewardHistory.push(this.roundReward);
    this.damageDealtHistory.push(this.roundDamageDealt);
    this.roundLengths.push(roundTicks);
    this.winRateHistory.push(this.wins / this.rounds);

    // Rolling win rate (last 20)
    const W = 20;
    const recentStart = Math.max(0, this.rounds - W);
    const winsAtStart = recentStart > 0
      ? Math.round(this.winRateHistory[recentStart - 1] * recentStart) : 0;
    const recentWins = this.wins - winsAtStart;
    const recentTotal = this.rounds - recentStart;
    this.rollingWinRate.push(recentTotal > 0 ? recentWins / recentTotal : 0.5);

    const recentDmg = this.damageDealtHistory.slice(-W);
    this.avgDmgDealtHistory.push(
      recentDmg.length > 0 ? recentDmg.reduce((a, b) => a + b) / recentDmg.length : 0
    );

    this.roundReward = 0;
    this.roundDamageDealt = 0;

    this.replay(60);
    this.epsilon = Math.max(this.minEpsilon, this.epsilon * this.epsilonDecay);
    this.lastState = null;
    this.lastAction = null;
  }

  getStats() {
    const last20Wr = this.rollingWinRate.length > 0
      ? (this.rollingWinRate[this.rollingWinRate.length - 1] * 100).toFixed(1) : '50.0';
    const last20Dmg = this.avgDmgDealtHistory.length > 0
      ? this.avgDmgDealtHistory[this.avgDmgDealtHistory.length - 1].toFixed(0) : '0';
    return {
      rounds: this.rounds,
      wins: this.wins,
      losses: this.losses,
      winRate: last20Wr,
      cumulativeWr: this.rounds > 0 ? (this.wins / this.rounds * 100).toFixed(1) : '0',
      epsilon: (this.epsilon * 100).toFixed(1),
      statesExplored: Object.keys(this.q).length,
      avgDmg: last20Dmg,
      replaySize: this.replayBuffer.length,
    };
  }

  // ── Persistence ──

  save() {
    const key = `brain_${this.id}`;
    const data = {
      q: {}, epsilon: this.epsilon, totalReward: this.totalReward,
      wins: this.wins, losses: this.losses, rounds: this.rounds,
      rewardHistory: this.rewardHistory.slice(-500),
      winRateHistory: this.winRateHistory.slice(-500),
      rollingWinRate: this.rollingWinRate.slice(-500),
      damageDealtHistory: this.damageDealtHistory.slice(-500),
      avgDmgDealtHistory: this.avgDmgDealtHistory.slice(-500),
      roundLengths: this.roundLengths.slice(-500),
      replayBuffer: this.replayBuffer.slice(-300),
    };
    for (const [s, qvals] of Object.entries(this.q)) {
      data.q[s] = Array.from(qvals);
    }
    try { localStorage.setItem(key, JSON.stringify(data)); }
    catch (e) { console.warn('Brain save failed:', e); }
  }

  load() {
    const key = `brain_${this.id}`;
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return false;
      const data = JSON.parse(raw);
      this.epsilon = data.epsilon ?? this.epsilon;
      this.totalReward = data.totalReward ?? 0;
      this.wins = data.wins ?? 0;
      this.losses = data.losses ?? 0;
      this.rounds = data.rounds ?? 0;
      this.rewardHistory = data.rewardHistory ?? [];
      this.winRateHistory = data.winRateHistory ?? [];
      this.rollingWinRate = data.rollingWinRate ?? [];
      this.damageDealtHistory = data.damageDealtHistory ?? [];
      this.avgDmgDealtHistory = data.avgDmgDealtHistory ?? [];
      this.roundLengths = data.roundLengths ?? [];
      this.replayBuffer = data.replayBuffer ?? [];
      for (const [s, arr] of Object.entries(data.q || {})) {
        this.q[s] = new Float32Array(arr);
      }
      console.log(`Brain ${this.id} loaded: ${this.rounds} rounds, ${Object.keys(this.q).length} states`);
      return true;
    } catch (e) { console.warn('Brain load failed:', e); return false; }
  }

  export() {
    const data = {
      id: this.id, rounds: this.rounds, wins: this.wins, losses: this.losses,
      epsilon: this.epsilon, totalReward: this.totalReward,
      statesExplored: Object.keys(this.q).length,
      rewardHistory: this.rewardHistory, winRateHistory: this.winRateHistory,
      rollingWinRate: this.rollingWinRate,
      damageDealtHistory: this.damageDealtHistory,
      avgDmgDealtHistory: this.avgDmgDealtHistory,
      q: {},
    };
    for (const [s, qvals] of Object.entries(this.q)) {
      data.q[s] = Array.from(qvals);
    }
    return data;
  }
}

// Helper — check if a player is mid-attack (avoid circular import)
let _ATTACKS = null;
export function initBrainCombatRef(attacks) { _ATTACKS = attacks; }
function _isAttacking(player) {
  return _ATTACKS ? !!_ATTACKS[player.currentAnimName] : false;
}
