// Match event logger — records all combat events for training data.

export class MatchLogger {
  constructor() {
    this.events = [];
    this.startTime = 0;
    this.frameCount = 0;
  }

  reset() {
    this.events = [];
    this.startTime = performance.now();
    this.frameCount = 0;
  }

  /** Build a state snapshot of both players. */
  captureState(p1, p2) {
    const snap = (p) => ({
      x: p.model ? +p.model.position.x.toFixed(2) : 0,
      z: p.model ? +p.model.position.z.toFixed(2) : 0,
      health: +p.health.toFixed(1),
      anim: p.currentAnimName,
      isBlocking: p.isBlocking,
      isMoving: p.isMoving,
      class: p.classDef?.name || 'unknown',
    });
    return {
      timestamp: +(performance.now() - this.startTime).toFixed(1),
      frame: this.frameCount,
      p1: snap(p1),
      p2: snap(p2),
      distance: p1.model && p2.model
        ? +p1.model.position.distanceTo(p2.model.position).toFixed(2)
        : 0,
    };
  }

  /**
   * Log a combat event.
   * @param {object} opts
   * @param {string} opts.event     - 'hit' | 'block' | 'dodge' | 'miss' | 'ko' | 'round_start' | 'action'
   * @param {string|null} opts.attacker - 'p1' | 'p2' | null
   * @param {string|null} opts.action   - animation name
   * @param {number|null} opts.damage
   * @param {string|null} opts.result   - 'hit' | 'blocked' | 'dodged' | 'miss' | 'ko'
   * @param {object} state - from captureState()
   */
  logEvent({ event, attacker = null, action = null, damage = null, result = null }, state) {
    this.events.push({
      ...state,
      event,
      attacker,
      action,
      damage,
      result,
    });
  }

  /** Log an action taken (attack, block, etc) — useful for tracking AI/human choices. */
  logAction(playerId, animName, state) {
    this.events.push({
      ...state,
      event: 'action',
      attacker: playerId,
      action: animName,
      damage: null,
      result: null,
    });
  }

  getLog() {
    return this.events;
  }

  downloadLog() {
    if (!this.events.length) return;
    const json = JSON.stringify(this.events, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    a.href = url;
    a.download = `match_log_${ts}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }
}
