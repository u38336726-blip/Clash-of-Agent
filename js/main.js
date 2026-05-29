import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { scene, camera, renderer, orbitControls, clock, toggleArena, updateArenaTransition, isArenaReady } from './scene.js';
import { Player } from './player.js';
import { checkAttackHit } from './combat.js';
import { CLASS_DEFS, getClassActions } from './classes.js';
import { initControls, processMovement } from './controls.js';
import { AIController } from './ai.js';
import { MatchLogger } from './logger.js';
import { runGhostBatch, getGhostLog } from './headless.js';
import { DIFFICULTIES, setDifficulty, activeDifficulty } from './difficulty.js';
import * as UI from './ui.js';

let player1, player2;
let shakeIntensity = 0;
let gameMode = '2p';
let ai1 = null, ai2 = null; // AI controllers
const logger = new MatchLogger();

// Training state
let simSpeed = 1;
let autoRestart = false;
let roundCount = 0;
let ghostRounds = 0; // headless fights completed
let gltfCache = { gltf1: null, gltf2: null };
let p1ClassId, p2ClassId;
let ghostsPerRound = 0; // disabled — 3D training only

// ── Boot ──

async function boot() {
  // Show splash first
  await UI.showSplash();

  const loader = new GLTFLoader();
  const load = (url) => new Promise((res, rej) => loader.load(url, res, undefined, rej));

  let gltf1, gltf2;
  try {
    [gltf1, gltf2] = await Promise.all([load('assets/character.glb'), load('assets/character.glb')]);
  } catch (e) {
    document.getElementById('loading').textContent = 'Load error: ' + e.message;
    return;
  }
  gltfCache = { gltf1, gltf2 };

  UI.hideLoading();
  UI.markAssetsLoaded();

  await menuLoop();

  initMatch();
  animate();
}

async function menuLoop() {
  let step = 'mode'; // 'mode' | 'difficulty' | 'class'

  while (true) {
    if (step === 'mode') {
      try {
        gameMode = await UI.showModeSelect();
        autoRestart = (gameMode === 'train');
        step = (gameMode === '1p') ? 'difficulty' : 'class';
      } catch (e) {
        if (e === 'back-to-splash') {
          UI.showSplashFromBack();
          await UI.showSplash();
          step = 'mode';
          continue;
        }
        throw e;
      }
    } else if (step === 'difficulty') {
      try {
        const diffKey = await UI.showDifficultySelect(DIFFICULTIES);
        setDifficulty(diffKey);
        step = 'class';
      } catch (e) {
        if (e === 'back-to-mode') { step = 'mode'; continue; }
        throw e;
      }
    } else if (step === 'class') {
      try {
        const sel = await UI.showClassSelect(gameMode);
        p1ClassId = sel.p1Class;
        p2ClassId = sel.p2Class;
        return; // done, start the game
      } catch (e) {
        if (e === 'back-to-difficulty') { step = 'difficulty'; continue; }
        if (e === 'back-to-mode') { step = 'mode'; continue; }
        throw e;
      }
    }
  }
}

async function initMatch() {
  const p1Def = CLASS_DEFS[p1ClassId];
  const p2Def = CLASS_DEFS[p2ClassId];

  // Re-create players each round (reload model from cached gltf)
  // For first round, use gltfCache directly. For rematches, reload.
  // Start closer in training mode so fights happen immediately
  const startDist = gameMode === 'train' ? 1.5 : 2.5;

  if (!player1) {
    player1 = new Player('p1', -startDist, p1Def, document.getElementById('p1-toast'));
    player2 = new Player('p2',  startDist, p2Def, document.getElementById('p2-toast'));
    player1.init(gltfCache.gltf1);
    player2.init(gltfCache.gltf2);
  } else {
    player1.startX = -startDist;
    player2.startX = startDist;
    player1.reset();
    player2.reset();
  }

  // Training mode: randomize starting HP so brain sees all HP states
  // Some fights start full, some start low — covers the whole state space
  if (gameMode === 'train') {
    const hpRoll = Math.random();
    let hpPct;
    if (hpRoll < 0.3)      hpPct = 0.15 + Math.random() * 0.15;  // 15-30% — fast KO rounds
    else if (hpRoll < 0.6)  hpPct = 0.4 + Math.random() * 0.2;   // 40-60% — mid fights
    else                     hpPct = 0.8 + Math.random() * 0.2;   // 80-100% — full fights
    player1.health = Math.round(player1.maxHealth * hpPct);
    player2.health = Math.round(player2.maxHealth * hpPct);
  }

  const p1Actions = getClassActions(p1ClassId, 'p1');
  const p2Actions = getClassActions(p2ClassId, 'p2');

  UI.showGameUI();
  // Arena stays hidden — click ARENA button to morph it in
  UI.buildPanel('p1-panel', p1Actions, player1, 'active-p1');
  UI.buildPanel('p2-panel', p2Actions, player2, 'active-p2');
  UI.updateHealthBar(player1);
  UI.updateHealthBar(player2);

  const p1Label = gameMode === 'train' ? 'AI-1 ' + CLASS_DEFS[p1ClassId].name : CLASS_DEFS[p1ClassId].name;
  const p2Label = (gameMode === '1p' || gameMode === 'train') ? 'AI ' + CLASS_DEFS[p2ClassId].name : CLASS_DEFS[p2ClassId].name;
  document.getElementById('p1-label').textContent = p1Label;
  document.getElementById('p2-label').textContent = p2Label;

  // Controls
  initControls(player1, player2, p1Actions, p2Actions, UI, gameMode);

  // AI controllers
  const useBrain = (gameMode === 'train');

  if (gameMode === 'train') {
    // Preserve brains across rounds + load from localStorage
    if (!ai1) {
      ai1 = new AIController(player1, player2, p1Actions, true);
      ai2 = new AIController(player2, player1, p2Actions, true);
      // Try to load previously trained brains
      const loaded1 = ai1.brain.load();
      const loaded2 = ai2.brain.load();
      if (loaded1 || loaded2) {
        roundCount = Math.max(ai1.brain.rounds, ai2.brain.rounds);
        console.log(`Resumed training from round ${roundCount}`);
      }
    } else {
      ai1.player = player1; ai1.opponent = player2; ai1.actions = p1Actions;
      ai1.combatActions = p1Actions.filter(a => a.category === 'combat');
      ai1.reset();
      ai2.player = player2; ai2.opponent = player1; ai2.actions = p2Actions;
      ai2.combatActions = p2Actions.filter(a => a.category === 'combat');
      ai2.reset();
    }
  } else if (gameMode === '1p') {
    ai2 = new AIController(player2, player1, p2Actions, true);
    ai1 = null;
    // Always load shipped brain for 1P (localStorage may have stale/broken training data)
    try {
      const resp = await fetch('assets/trained_brain_p2.json');
      const data = await resp.json();
      for (const [s, arr] of Object.entries(data.q || {})) {
        ai2.brain.q[s] = new Float32Array(arr);
      }
      ai2.brain.rounds = data.rounds || 0;
      ai2.brain.wins = data.wins || 0;
      ai2.brain.losses = data.losses || 0;
      console.log(`Loaded shipped brain: ${Object.keys(data.q).length} states`);
    } catch (e) {
      console.log('No shipped brain, using fresh');
    }
    // Set AI behavior from difficulty
    ai2.brain.epsilon = activeDifficulty.aiEpsilon;
    ai2.decisionInterval = activeDifficulty.aiDecisionSpeed;
  } else {
    ai1 = null; ai2 = null;
  }

  // Logger
  logger.reset();
  logger.logEvent({ event: 'round_start' }, logger.captureState(player1, player2));

  // Mixer timeScale stays at 1 — speed is handled by dt multiplication
  if (player1.mixer) player1.mixer.timeScale = 1;
  if (player2.mixer) player2.mixer.timeScale = 1;

  UI.hideKO();
  UI.resetHealthBarColors();

  // Show training dashboard
  if (gameMode === 'train') {
    UI.showTrainingDashboard(true);
    UI.updateSpeedDisplay(simSpeed);
  }
}

// ── KO handler ──

let koHandled = false;

function handleKO(winner, loser) {
  if (koHandled) return;
  koHandled = true;
  roundCount++;

  const state = logger.captureState(player1, player2);
  logger.logEvent({ event: 'ko', attacker: winner.id, result: 'ko' }, state);

  // Reward AIs + end round with accumulated ticks
  if (ai1?.brain) {
    ai1.reward(winner === player1 ? 50 : -50);
    ai1.brain.endRound(winner === player1, logger.frameCount);
  }
  if (ai2?.brain) {
    ai2.reward(winner === player2 ? 50 : -50);
    ai2.brain.endRound(winner === player2, logger.frameCount);
  }

  // Run ghost fights between visible rounds (parallel headless training)
  if (gameMode === 'train' && ai1?.brain && ai2?.brain) {
    const p1Def = CLASS_DEFS[p1ClassId];
    const p2Def = CLASS_DEFS[p2ClassId];
    const p1Anims = getClassActions(p1ClassId, 'p1').filter(a => a.category === 'combat').map(a => a.anim);
    const p2Anims = getClassActions(p2ClassId, 'p2').filter(a => a.category === 'combat').map(a => a.anim);

    const result = runGhostBatch(ai1.brain, ai2.brain, p1Def, p2Def, p1Anims, p2Anims, ghostsPerRound);
    ghostRounds += ghostsPerRound;
    roundCount += ghostsPerRound;
  }

  // Auto-save every 10 visible rounds
  if (gameMode === 'train' && roundCount % 10 === 0) {
    if (ai1?.brain) ai1.brain.save();
    if (ai2?.brain) ai2.brain.save();
    _saveLogBuffer();
  }

  // Update training dashboard
  if (gameMode === 'train') {
    UI.updateTrainingStats(ai1, ai2, roundCount, simSpeed, ghostRounds);
    UI.updateGraph(ai1, ai2);
  }

  if (autoRestart) {
    setTimeout(() => {
      koHandled = false;
      initMatch();
      if (hyperMode) runHyperLoop();
    }, hyperMode ? 0 : Math.max(50, 300 / simSpeed));
  } else {
    UI.showKO(winner);
  }
}

// ── Hit resolution ──

function resolveHit(attacker, victim) {
  const result = checkAttackHit(attacker, victim);
  if (!result) return;

  const state = logger.captureState(player1, player2);
  const attackerAI = attacker === player1 ? ai1 : ai2;
  const victimAI = attacker === player1 ? ai2 : ai1;

  if (result.dodged) {
    UI.showDodge(victim.id);
    if (attackerAI) attackerAI.reward(-1);   // missed
    if (victimAI)   victimAI.reward(1);      // dodged — small reward, moving is better than blocking
    logger.logEvent({ event: 'dodge', attacker: attacker.id, action: attacker.currentAnimName, result: 'dodged' }, state);
    return;
  }

  if (result.blocked) {
    UI.showBlock(victim.id);
    victim.takeDamage(result.damage, result.reaction, true);
    UI.updateHealthBar(victim);
    shakeIntensity = 0.02;
    if (attackerAI) attackerAI.reward(-1);   // blocked
    if (victimAI)   victimAI.reward(-1);     // blocked = you're not dealing damage either, slight negative
    logger.logEvent({ event: 'block', attacker: attacker.id, action: attacker.currentAnimName, damage: result.damage, result: 'blocked' }, state);
    if (victim.health <= 0) handleKO(attacker, victim);
    return;
  }

  // Clean hit
  victim.takeDamage(result.damage, result.reaction);
  UI.flashHit(victim.id);
  UI.showCombo(attacker);
  UI.updateHealthBar(victim);
  shakeIntensity = Math.min(0.08, result.damage * 0.004);
  if (attackerAI) attackerAI.reward(result.damage * 0.5);  // reward proportional to damage
  if (victimAI)   victimAI.reward(-result.damage * 0.3);   // punish for taking hit
  logger.logEvent({ event: 'hit', attacker: attacker.id, action: attacker.currentAnimName, damage: result.damage, result: 'hit' }, state);

  if (victim.health <= 0) handleKO(attacker, victim);
}

// ── Speed control (called from UI) ──

window._toggleArena = function() {
  if (isArenaReady()) toggleArena(3.0);
};

window._gameBack = function() {
  if (!confirm('Leave match?')) return;
  // Stop current game
  koHandled = true;
  hyperMode = false;
  autoRestart = false;
  // Hide game UI
  document.getElementById('ui').style.display = 'none';
  UI.showTrainingDashboard(false);
  UI.hideKO();
  // Reset players
  player1 = null; player2 = null;
  ai1 = null; ai2 = null;
  roundCount = 0; ghostRounds = 0;
  // Remove 3D models from scene
  scene.children.filter(c => c.type === 'Group' || c.type === 'Object3D').forEach(c => {
    if (c.userData?.isPlayer) scene.remove(c);
  });
  // Re-enter menu loop
  menuLoop().then(() => {
    koHandled = false;
    initMatch();
  });
};

window._setSimSpeed = function(s) {
  simSpeed = s;
  UI.updateSpeedDisplay(s);
};

window._setGhosts = function(n) {
  ghostsPerRound = n;
  const el = document.getElementById('ghost-val');
  if (el) el.textContent = n + ' ghosts';
};

// ── Persistence helpers ──

/** Save recent match log events to localStorage (rolling buffer of last 2000 events) */
function _saveLogBuffer() {
  try {
    const existing = JSON.parse(localStorage.getItem('match_logs') || '[]');
    const combined = existing.concat(logger.getLog());
    // Keep last 5000 events to avoid storage bloat
    const trimmed = combined.slice(-5000);
    localStorage.setItem('match_logs', JSON.stringify(trimmed));
    logger.reset(); // clear in-memory buffer after saving
    logger.logEvent({ event: 'round_start' }, { timestamp: 0, frame: 0, p1: {}, p2: {}, distance: 0 });
  } catch (e) {
    console.warn('Log save failed:', e);
  }
}

/** Export all training data (brains + logs) as a single JSON download */
window._exportTrainingData = function() {
  const ghosts = getGhostLog();
  const data = {
    exportedAt: new Date().toISOString(),
    roundsCompleted: roundCount,
    ghostRoundsCompleted: ghostRounds,
    ai1Brain: ai1?.brain?.export() || null,
    ai2Brain: ai2?.brain?.export() || null,
    matchLogs: JSON.parse(localStorage.getItem('match_logs') || '[]'),
    currentLogs: logger.getLog(),
    ghostFights: ghosts,
    ghostSummary: {
      total: ghosts.length,
      p1Wins: ghosts.filter(g => g.winner === 'p1').length,
      p2Wins: ghosts.filter(g => g.winner === 'p2').length,
      avgP1Dmg: ghosts.length > 0 ? +(ghosts.reduce((s, g) => s + g.p1Dmg, 0) / ghosts.length).toFixed(1) : 0,
      avgP2Dmg: ghosts.length > 0 ? +(ghosts.reduce((s, g) => s + g.p2Dmg, 0) / ghosts.length).toFixed(1) : 0,
      avgFightLength: ghosts.length > 0 ? +(ghosts.reduce((s, g) => s + g.ticks, 0) / ghosts.length).toFixed(0) : 0,
    },
  };
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `training_data_${roundCount}rounds_${new Date().toISOString().slice(0,19).replace(/[:.]/g,'-')}.json`;
  a.click();
  URL.revokeObjectURL(url);
};

/** Clear saved brains and logs */
window._resetTraining = function() {
  localStorage.removeItem('brain_p1');
  localStorage.removeItem('brain_p2');
  localStorage.removeItem('match_logs');
  location.reload();
};

window._resetBrain1 = function() {
  localStorage.removeItem('brain_p1');
  if (ai1?.brain) { ai1.brain = new (ai1.brain.constructor)(ai1.brain.id); ai1.brain.save(); }
  console.log('AI-1 brain reset');
};

window._resetBrain2 = function() {
  localStorage.removeItem('brain_p2');
  if (ai2?.brain) { ai2.brain = new (ai2.brain.constructor)(ai2.brain.id); ai2.brain.save(); }
  console.log('AI-2 brain reset');
};

// ── Manual KO handlers ──

document.getElementById('ko-restart')?.addEventListener('click', () => {
  koHandled = false;
  initMatch();
});

document.getElementById('ko-download-log')?.addEventListener('click', () => {
  logger.downloadLog();
});

// ── Game loop ──

// Training speed: run game logic in a tight loop, render occasionally
let turboSteps = 1;
let hyperMode = false; // true = skip rendering entirely, max speed

window._setTurbo = function(n) {
  turboSteps = Math.max(1, n);
  const el = document.getElementById('turbo-val');
  if (el) el.textContent = turboSteps === 1 ? 'OFF' : turboSteps + 'x';
};

window._setHyper = function(on) {
  hyperMode = on;
  const el = document.getElementById('hyper-val');
  if (el) el.textContent = on ? 'ON' : 'OFF';
  if (on) runHyperLoop();
};

function gameTick(dt) {
  logger.frameCount++;
  processMovement(dt, player1, player2);
  if (ai1) ai1.update(dt);
  if (ai2) ai2.update(dt);

  if (player1.model && player2.model) {
    player1.faceTarget(player2.model.position);
    player2.faceTarget(player1.model.position);

    if (!koHandled) {
      resolveHit(player1, player2);
      resolveHit(player2, player1);
    }
  }

  player1.update(dt);
  player2.update(dt);
}

// Hyper mode: run game logic in tight loop using setTimeout(0),
// render only every ~500ms for visual feedback
function runHyperLoop() {
  if (!hyperMode || gameMode !== 'train') return;

  const tickDt = 0.05; // fixed 50ms game step
  const batchSize = 200; // ticks per JS batch before yielding
  let renderCounter = 0;

  function batch() {
    if (!hyperMode) return;
    const start = performance.now();

    // Run up to 16ms of game logic per JS frame (~60fps yield rate)
    while (performance.now() - start < 16) {
      for (let i = 0; i < batchSize; i++) {
        if (koHandled) break;
        gameTick(tickDt);
      }
      if (koHandled) break;
    }

    renderCounter++;
    // Render every ~30 batches (~500ms) so you can see progress
    if (renderCounter % 30 === 0) {
      if (player1.model && player2.model) {
        UI.updateProximity(player1.model.position.distanceTo(player2.model.position));
      }
      UI.updateHealthBar(player1);
      UI.updateHealthBar(player2);
      orbitControls.update();
      renderer.render(scene, camera);
    }

    setTimeout(batch, 0);
  }

  batch();
}

function animate() {
  requestAnimationFrame(animate);

  // In hyper mode, the hyper loop handles game logic
  if (hyperMode) return;

  const realDt = clock.getDelta();
  const dt = Math.min(realDt * simSpeed, 0.15);

  const stepDt = dt / turboSteps;
  for (let i = 0; i < turboSteps; i++) {
    if (koHandled) break;
    gameTick(stepDt);
  }

  if (player1.model && player2.model) {
    UI.updateProximity(player1.model.position.distanceTo(player2.model.position));
  }

  if (shakeIntensity > 0.001) {
    camera.position.x += (Math.random() - 0.5) * shakeIntensity;
    camera.position.y += (Math.random() - 0.5) * shakeIntensity * 0.5;
    shakeIntensity *= 0.9;
  }

  updateArenaTransition();
  orbitControls.update();
  renderer.render(scene, camera);
}

boot();
