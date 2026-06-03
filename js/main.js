import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { scene, camera, renderer, orbitControls, clock, toggleArena, updateArenaTransition, isArenaReady, isArenaVisible, updateCameraForFight } from './scene.js';

// ── Wrist debug spheres (toggle with D key) ──
let showBoneDebug = false;
const wristSpheres = [];
function initBoneDebug() {
  const geo = new THREE.SphereGeometry(0.06, 8, 8);
  const colors = [0xff4400, 0x0044ff, 0xff00ff, 0x00ffff];
  for (let i = 0; i < 4; i++) {
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: colors[i] }));
    mesh.visible = false;
    scene.add(mesh);
    wristSpheres.push(mesh);
  }
}
function updateBoneDebug() {
  if (!showBoneDebug || !player1 || !player2) {
    wristSpheres.forEach(s => s.visible = false);
    return;
  }
  const targets = [
    { player: player1, sphere: wristSpheres[0], bone: 'rightHand' },
    { player: player1, sphere: wristSpheres[1], bone: 'leftHand' },
    { player: player2, sphere: wristSpheres[2], bone: 'rightHand' },
    { player: player2, sphere: wristSpheres[3], bone: 'leftHand' },
  ];
  [[player1, 0, 1], [player2, 2, 3]].forEach(([p, ri, li]) => {
    [['rightHand', ri], ['leftHand', li]].forEach(([boneName, si]) => {
      const bone = p[boneName];
      if (bone) {
        const pos = new THREE.Vector3();
        bone.getWorldPosition(pos);
        wristSpheres[si].position.copy(pos);
        wristSpheres[si].visible = true;
      } else {
        wristSpheres[si].visible = false;
      }
    });
  });
}
document.addEventListener('keydown', e => {
  if (e.key === 'd' || e.key === 'D') {
    showBoneDebug = !showBoneDebug;
    console.log('Bone debug:', showBoneDebug ? 'ON' : 'OFF');
  }
});

// ── 3D Hit flash effects ──
const hitFlashes = [];
(function initHitFlashes() {
  for (let i = 0; i < 8; i++) {
    const geo = new THREE.RingGeometry(0.06, 0.3, 14);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffee88, transparent: true, opacity: 0,
      side: THREE.DoubleSide, depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.visible = false;
    scene.add(mesh);
    hitFlashes.push({ mesh, life: 0, maxLife: 0.2 });
  }
})();

function spawnHitFlash(pos) {
  const f = hitFlashes.find(f => f.life <= 0);
  if (!f || !pos) return;
  f.mesh.position.set(pos.x, Math.max(0.4, pos.y), pos.z);
  f.mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI * 2);
  f.mesh.scale.setScalar(1.0);
  f.mesh.material.opacity = 1.0;
  f.mesh.visible = true;
  f.life = f.maxLife;
}

function updateHitFlashes(dt) {
  hitFlashes.forEach(f => {
    if (f.life <= 0) { f.mesh.visible = false; return; }
    f.life -= dt;
    const t = f.life / f.maxLife;
    f.mesh.material.opacity = t * 0.9;
    f.mesh.scale.setScalar(1.0 + (1 - t) * 2.2);
  });
}
import { Player } from './player.js';
import { checkAttackHit } from './combat.js';
import { CLASS_DEFS, getClassActions } from './classes.js';
import { initControls, processMovement } from './controls.js';
import { AIController } from './ai.js';
import { MatchLogger } from './logger.js';
import { runGhostBatch, getGhostLog } from './headless.js';
import { DIFFICULTIES, setDifficulty, activeDifficulty } from './difficulty.js';
import * as UI from './ui.js';
import {
  unlockAudio,
  setAudioScene,
  playUiSelectSound,
  playRoundStartSound,
  playBlockSound,
  playHitSound,
  playKoSound,
} from './sfx.js';

let player1, player2;
let shakeIntensity = 0;
let gameMode = 'train'; // AI vs AI direct
let ai1 = null, ai2 = null;
const logger = new MatchLogger();
const DEFAULT_TRAIN_SIM_SPEED = 0.85;

function getDefaultSimSpeed(mode) {
  return mode === 'train' ? DEFAULT_TRAIN_SIM_SPEED : 1;
}

// Training state
let simSpeed = getDefaultSimSpeed(gameMode);
let autoRestart = false; // show KO screen, don't auto-restart
let roundCount = 0;
let ghostRounds = 0;
let gltfCache = { gltf1: null, gltf2: null };
let p1ClassId = 'street';  // P1 class
let p2ClassId = 'mma';     // P2 class
let ghostsPerRound = 0;
let koRevealTimer = null;
let koAutoTimer = null;

window.addEventListener('pointerdown', unlockAudio, { passive: true });
window.addEventListener('keydown', unlockAudio);
setAudioScene('menu');

document.addEventListener('click', (event) => {
  const target = event.target.closest('button, .class-card, a');
  if (!target || target.disabled) return;

  let kind = 'select';
  if (target.classList.contains('back-btn') || target.id === 'game-back' || target.id === 'ko-home' || target.id === 'back-btn') {
    kind = 'back';
  } else if (target.id === 'splash-start' || target.id === 'fight-btn' || target.id === 'ko-restart') {
    kind = 'confirm';
  } else if (target.classList.contains('speed-btn') || target.classList.contains('train-btn') || target.id === 'arena-toggle') {
    kind = 'toggle';
  }

  playUiSelectSound(kind);
}, true);

// ── Boot ──

async function boot() {
  // Show mode select directly (skip splash)
  delete document.body.dataset.mode;
  setAudioScene('menu');
  document.getElementById('splash-screen').style.display = 'none';
  document.getElementById('mode-select').style.display = 'flex';

  // Load assets in background while user picks mode
  const loader = new GLTFLoader();
  const load = (url) => new Promise((res, rej) => loader.load(url, res, undefined, rej));

  let gltf1, gltf2;
  const loadPromise = Promise.all([
    load('assets/character.glb'),
    load('assets/character.glb')
  ]).then(([g1, g2]) => {
    gltfCache = { gltf1: g1, gltf2: g2 };
    UI.markAssetsLoaded();
  }).catch(e => {
    console.error('Load error:', e);
  });

  // Wait for mode selection
  const mode = await new Promise(resolve => {
    document.querySelectorAll('.mode-btn').forEach(btn => {
      btn.addEventListener('click', () => resolve(btn.dataset.mode), { once: true });
    });
  });

  // If assets not loaded yet, show loading
  if (!gltfCache.gltf1) {
    document.getElementById('mode-select').style.display = 'none';
    document.getElementById('loading').style.display = 'flex';
    await loadPromise;
    document.getElementById('loading').style.display = 'none';
  } else {
    document.getElementById('mode-select').style.display = 'none';
  }

  gameMode = mode;
  document.body.dataset.mode = gameMode;
  simSpeed = getDefaultSimSpeed(gameMode);
  autoRestart = false;

  // For train mode: auto-pick classes and go straight to fight
  if (mode === 'train') {
    p1ClassId = 'street';
    p2ClassId = 'mma';
    setDifficulty('hard');
    initBoneDebug();
    initMatch();
    animate();
    return;
  }

  // For 1p/2p: go through class select
  await menuLoop();
  initMatch();
  animate();
}

function setupAnimTester() {
  const allAnims = [
    // Movement
    'Idle_Loop','Walk_Loop','Walk_Back_Loop',
    // Punches
    'Jab','Hook','Hook_Right','Cross','Uppercut','Uppercut_Combo','Body_Punch','Body_Punch_L','Elbow',
    // Kicks
    'Kick_Front','Kick_Round','Kick_MMA','Kick_Side',
    // Power
    'Tackle','Sweep','Counter','Finisher',
    // Reactions — punch
    'Hit_Chest','Hit_Head','Hit_Heavy',
    // Reactions — kick specific
    'Hit_Kick','Hit_KickR','Hit_KickM','Hit_Uppercut',
    // KO / recovery
    'Death01','Death02','GetUp','Lying_Down',
    // Defense
    'Block_Loop','Roll',
  ];

  const container = document.getElementById('anim-buttons');
  allAnims.forEach(name => {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:4px;margin-bottom:3px;align-items:center';

    const label = document.createElement('span');
    label.textContent = name;
    label.style.cssText = 'flex:1;font-size:10px;color:#ccc';

    const btn1 = document.createElement('button');
    btn1.textContent = 'P1';
    btn1.style.cssText = 'font-size:9px;padding:1px 5px;background:#1a3a6a;color:#fff;border:1px solid #4a7aaa;cursor:pointer';
    btn1.onclick = () => { if(player1) player1.play(name, 0.1); };

    const btn2 = document.createElement('button');
    btn2.textContent = 'P2';
    btn2.style.cssText = 'font-size:9px;padding:1px 5px;background:#6a1a1a;color:#fff;border:1px solid #aa4a4a;cursor:pointer';
    btn2.onclick = () => { if(player2) player2.play(name, 0.1); };

    row.appendChild(label);
    row.appendChild(btn1);
    row.appendChild(btn2);
    container.appendChild(row);
  });
}

async function menuLoop() {
  let step = 'mode'; // 'mode' | 'difficulty' | 'class'

  while (true) {
    if (step === 'mode') {
      try {
        gameMode = await UI.showModeSelect();
        document.body.dataset.mode = gameMode;
        simSpeed = getDefaultSimSpeed(gameMode);
        autoRestart = false;
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
  const sceneName = gameMode === 'train' ? 'train' : 'fight';

  // Re-create players each round (reload model from cached gltf)
  // For first round, use gltfCache directly. For rematches, reload.
  // Start closer in training mode so fights happen immediately
  // Spawn near live contact range so the match starts as a fight, not a walk-in.
  const startDist = gameMode === 'train' ? 0.8 : 0.95;

  if (!player1) {
    player1 = new Player('p1', -startDist, p1Def, document.getElementById('p1-toast'));
    player2 = new Player('p2',  startDist, p2Def, document.getElementById('p2-toast'));
    player1.init(gltfCache.gltf1);
    player2.init(gltfCache.gltf2);
  } else {
    // Full reset — restore position, health, animations, mixer speed
    player1.startX = -startDist;
    player2.startX = startDist;
    if (player1.mixer) player1.mixer.timeScale = 1;
    if (player2.mixer) player2.mixer.timeScale = 1;
    player1.reset();
    player2.reset();
  }

  // Always start with FULL health (no randomization in AI vs AI mode)
  player1.health = player1.maxHealth;
  player2.health = player2.maxHealth;

  const p1Actions = getClassActions(p1ClassId, 'p1');
  const p2Actions = getClassActions(p2ClassId, 'p2');
  const showP1Panel = gameMode !== 'train';
  const showP2Panel = gameMode === '2p';

  UI.showGameUI();
  setAudioScene(sceneName);
  playRoundStartSound(sceneName);
  // Auto-reveal arena on match start
  if (isArenaReady() && !isArenaVisible()) toggleArena(3.0);
  UI.buildPanel('p1-panel', p1Actions, player1, 'active-p1');
  UI.buildPanel('p2-panel', p2Actions, player2, 'active-p2');
  UI.setPanelVisibility('p1-panel', showP1Panel);
  UI.setPanelVisibility('p2-panel', showP2Panel);
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
  setAudioScene('ko');
  playKoSound();

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

  // Slow motion on KO moment so the death animation reads clearly.
  shakeIntensity = 0.15;
  if (player1.mixer) player1.mixer.timeScale = 0.35;
  if (player2.mixer) player2.mixer.timeScale = 0.35;

  const isTrainingKO = (gameMode === 'train');
  const revealDelay = hyperMode ? 0 : 1500;
  const autoContinueSeconds = isTrainingKO && autoRestart ? 3 : 0;

  clearTimeout(koRevealTimer);
  clearTimeout(koAutoTimer);

  koRevealTimer = setTimeout(() => {
    if (player1.mixer) player1.mixer.timeScale = 1;
    if (player2.mixer) player2.mixer.timeScale = 1;
    UI.showKO(winner, loser, gameMode, autoContinueSeconds);
  }, revealDelay);

  if (autoContinueSeconds > 0) {
    koAutoTimer = setTimeout(() => {
      startNextRound();
    }, revealDelay + autoContinueSeconds * 1000);
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
    playBlockSound();
    victim.takeDamage(result.damage, result.reaction, true, attacker);
    UI.updateHealthBar(victim);
    shakeIntensity = 0.02;
    if (attackerAI) attackerAI.reward(-1);   // blocked
    if (victimAI)   victimAI.reward(-1);     // blocked = you're not dealing damage either, slight negative
    logger.logEvent({ event: 'block', attacker: attacker.id, action: attacker.currentAnimName, damage: result.damage, result: 'blocked' }, state);
    if (victim.health <= 0) handleKO(attacker, victim);
    return;
  }

  // Clean hit
  victim.takeDamage(result.damage, result.reaction, false, attacker);
  playHitSound(result.damage);
  UI.flashHit(victim.id);
  UI.showCombo(attacker);
  UI.updateHealthBar(victim);
  shakeIntensity = Math.min(0.3, result.damage * 0.016);
  spawnHitFlash(victim.getBodyPos());
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
  goHome();
};

window._goHome = function() {
  goHome();
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
  startNextRound();
});

document.getElementById('ko-home')?.addEventListener('click', () => {
  goHome();
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
  if (!player1 || !player2) return;

  if (!koHandled) {
    processMovement(dt, player1, player2);
    if (ai1) ai1.update(dt);
    if (ai2) ai2.update(dt);

    if (player1.model && player2.model) {
      player1.faceTarget(player2.model.position);
      player2.faceTarget(player1.model.position);
      player1.pushApart(player2);
    }
  }

  player1.update(dt);
  player2.update(dt);

  if (player1.model && player2.model) {
    player1.pushApart(player2);
  }

  if (player1.model && player2.model && !koHandled) {
    resolveHit(player1, player2);
    resolveHit(player2, player1);
    player1.pushApart(player2);
  }
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
        gameTick(tickDt);
      }
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
    gameTick(stepDt);
  }

  if (player1.model && player2.model) {
    UI.updateProximity(player1.model.position.distanceTo(player2.model.position));
    updateCameraForFight(player1.model.position, player2.model.position);
  }
  updateBoneDebug();
  updateHitFlashes(realDt);

  if (shakeIntensity > 0.001) {
    camera.position.x += (Math.random() - 0.5) * shakeIntensity;
    camera.position.y += (Math.random() - 0.5) * shakeIntensity * 0.5;
    camera.position.z += (Math.random() - 0.5) * shakeIntensity * 0.25;
    shakeIntensity *= 0.78;
  }

  updateArenaTransition();
  orbitControls.update();
  renderer.render(scene, camera);
}

boot();

function clearKOTimers() {
  clearTimeout(koRevealTimer);
  clearTimeout(koAutoTimer);
  koRevealTimer = null;
  koAutoTimer = null;
}

function removePlayersFromScene() {
  if (player1?.model) scene.remove(player1.model);
  if (player2?.model) scene.remove(player2.model);
}

function startNextRound() {
  clearKOTimers();
  UI.hideKO();
  koHandled = false;
  initMatch();
  if (hyperMode) runHyperLoop();
}

function goHome() {
  clearKOTimers();
  koHandled = true;
  hyperMode = false;
  autoRestart = false;
  delete document.body.dataset.mode;
  setAudioScene('menu');
  UI.resetMobileFightUi();
  document.getElementById('ui').style.display = 'none';
  UI.showTrainingDashboard(false);
  UI.hideKO();
  removePlayersFromScene();
  player1 = null;
  player2 = null;
  ai1 = null;
  ai2 = null;
  roundCount = 0;
  ghostRounds = 0;
  menuLoop().then(() => {
    autoRestart = false;
    koHandled = false;
    initMatch();
  });
}
