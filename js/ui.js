import { CLASS_DEFS } from './classes.js';

// --- Cached DOM refs ---
const hitFlash    = document.getElementById('hit-flash');
const proximityEl = document.getElementById('proximity');
const dodgeToast  = document.getElementById('dodge-toast');
const uiRoot      = document.getElementById('ui');
const fightAuxUi  = document.getElementById('fight-aux-ui');
const mobileUiToggle = document.getElementById('mobile-ui-toggle');
const mobileUiClose  = document.getElementById('mobile-ui-close');
const trainDetailsToggle = document.getElementById('train-details-toggle');
const trainDetailsModal = document.getElementById('train-details-modal');
const trainDetailsClose = document.getElementById('train-details-close');
let dodgeTimeout  = null;
let mobileUiBound = false;
let trainDetailsBound = false;

function isCompactFightUi() {
  return window.matchMedia('(hover: none) and (pointer: coarse)').matches
    && (window.innerWidth <= 900 || window.innerHeight <= 540);
}

export function setMobileFightUiOpen(open) {
  if (!uiRoot) return;
  const shouldOpen = !!open && isCompactFightUi();
  if (shouldOpen) setTrainDetailsOpen(false);
  uiRoot.classList.toggle('mobile-ui-open', shouldOpen);
  if (fightAuxUi) fightAuxUi.setAttribute('aria-hidden', shouldOpen ? 'false' : 'true');
  if (mobileUiToggle) mobileUiToggle.setAttribute('aria-expanded', shouldOpen ? 'true' : 'false');
}

export function resetMobileFightUi() {
  setMobileFightUiOpen(false);
}

export function setTrainDetailsOpen(open) {
  if (!uiRoot || !trainDetailsModal) return;
  const shouldOpen = !!open && document.body.dataset.mode === 'train';
  if (shouldOpen) setMobileFightUiOpen(false);
  uiRoot.classList.toggle('train-details-open', shouldOpen);
  trainDetailsModal.classList.toggle('show', shouldOpen);
  trainDetailsModal.setAttribute('aria-hidden', shouldOpen ? 'false' : 'true');
  if (trainDetailsToggle) trainDetailsToggle.setAttribute('aria-expanded', shouldOpen ? 'true' : 'false');
}

export function resetFightOverlays() {
  setMobileFightUiOpen(false);
  setTrainDetailsOpen(false);
}

export function initMobileFightUi() {
  if (mobileUiBound) return;
  mobileUiBound = true;

  mobileUiToggle?.addEventListener('click', () => setMobileFightUiOpen(true));
  mobileUiClose?.addEventListener('click', () => setMobileFightUiOpen(false));

  window.addEventListener('orientationchange', () => setMobileFightUiOpen(false));
  window.addEventListener('resize', () => {
    if (!isCompactFightUi()) setMobileFightUiOpen(false);
  }, { passive: true });

  setMobileFightUiOpen(false);
}

export function initTrainDetailsUi() {
  if (trainDetailsBound) return;
  trainDetailsBound = true;

  trainDetailsToggle?.addEventListener('click', () => setTrainDetailsOpen(true));
  trainDetailsClose?.addEventListener('click', () => setTrainDetailsOpen(false));
  trainDetailsModal?.addEventListener('click', (event) => {
    if (event.target === trainDetailsModal) setTrainDetailsOpen(false);
  });

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      setTrainDetailsOpen(false);
      setMobileFightUiOpen(false);
    }
  });

  window.addEventListener('orientationchange', () => setTrainDetailsOpen(false));
  window.addEventListener('resize', () => {
    if (document.body.dataset.mode !== 'train') setTrainDetailsOpen(false);
  }, { passive: true });

  setTrainDetailsOpen(false);
}

// ── Health bars ──

export function updateHealthBar(player) {
  const el = document.getElementById(`${player.id}-health`);
  const bar = el.querySelector('.health-bar');
  const txt = el.querySelector('.health-text');
  const pct = Math.max(0, (player.health / player.maxHealth) * 100);
  bar.style.width = pct + '%';
  txt.textContent = player.health <= 0 ? 'KO' : Math.round(player.health);

  if (pct < 25)      bar.style.background = 'linear-gradient(90deg, #ff2020, #cc1010)';
  else if (pct < 50)  bar.style.background = player.id === 'p1'
    ? 'linear-gradient(90deg, #cc8020, #ffaa30)'
    : 'linear-gradient(90deg, #ffaa30, #cc8020)';
  else                bar.style.background = '';
}

export function resetHealthBarColors() {
  document.querySelector('#p1-health .health-bar').style.background = '';
  document.querySelector('#p2-health .health-bar').style.background = '';
}

// ── Hit flash ──

export function flashHit(victimId) {
  hitFlash.className = victimId === 'p1' ? 'p1-hit' : 'p2-hit';
  setTimeout(() => { hitFlash.className = ''; }, 150);
}

// ── Dodge toast ──

export function showDodge(victimId) {
  showStatusToast(`${victimId === 'p1' ? 'P1' : 'P2'} DODGED!`, 'toast-dodge');
}

export function showBlock(victimId) {
  showStatusToast(`${victimId === 'p1' ? 'P1' : 'P2'} BLOCKED!`, 'toast-block');
}

function showStatusToast(text, variant) {
  dodgeToast.textContent = text;
  dodgeToast.className = variant;
  // Force animation restart when the same toast appears rapidly.
  void dodgeToast.offsetWidth;
  dodgeToast.classList.add('show');
  clearTimeout(dodgeTimeout);
  dodgeTimeout = setTimeout(() => {
    dodgeToast.classList.remove('show');
    dodgeToast.classList.remove('toast-dodge', 'toast-block');
  }, 850);
}

// ── Combo ──

export function showCombo(attacker) {
  attacker.combo++;
  clearTimeout(attacker.comboTimeout);
  const el = document.getElementById(`${attacker.id}-combo`);
  if (attacker.combo >= 2) {
    el.textContent = `${attacker.combo}x COMBO!`;
    el.classList.add('show');
  }
  attacker.comboTimeout = setTimeout(() => {
    attacker.combo = 0;
    el.classList.remove('show');
  }, 1500);
}

// ── Proximity ──

export function updateProximity(dist) {
  if (dist < 1.8)       { proximityEl.textContent = 'FIGHTING!'; proximityEl.className = 'close'; }
  else if (dist < 3.2)  { proximityEl.textContent = 'APPROACHING...'; proximityEl.className = 'near'; }
  else                   { proximityEl.className = ''; }
}

// ── KO ──

export function showKO(winner, loser, gameMode, autoContinueSeconds = 0) {
  resetFightOverlays();
  const winnerName = winner.id === 'p1' ? 'Player 1' : 'Player 2';
  const loserName = loser.id === 'p1' ? 'Player 1' : 'Player 2';
  document.getElementById('ko-winner').textContent = `${winnerName} ${winner.classDef.name.toUpperCase()} WINS`;
  document.getElementById('ko-loser').textContent = `${loserName} ${loser.classDef.name.toUpperCase()} IS KNOCKED OUT`;

  const note = document.getElementById('ko-note');
  const restartBtn = document.getElementById('ko-restart');
  if (gameMode === 'train') {
    restartBtn.textContent = 'NEXT ROUND';
    note.textContent = autoContinueSeconds > 0
      ? `AUTO NEXT ROUND IN ${autoContinueSeconds}s`
      : 'PRESS NEXT ROUND TO CONTINUE';
  } else {
    restartBtn.textContent = 'REMATCH';
    note.textContent = 'RESTART OR GO HOME';
  }

  document.getElementById('ko-overlay').classList.add('show');
}

export function hideKO() {
  document.getElementById('ko-overlay').classList.remove('show');
}

// ── Panels ──

export function buildPanel(panelId, actions, player, activeClass) {
  const panel = document.getElementById(panelId);
  panel.innerHTML = '';

  const titleDiv = document.createElement('div');
  titleDiv.className = 'panel-title';
  const side = player.id === 'p1' ? 'WASD' : 'Arrows';
  titleDiv.textContent = `${player.classDef.name} — ${side} move | Shift sprint`;
  panel.appendChild(titleDiv);

  const catNames = { move: 'Actions', combat: 'Combat', emote: 'Emotes' };
  ['move', 'combat', 'emote'].forEach(cat => {
    const items = actions.filter(a => a.category === cat);
    if (!items.length) return;

    const label = document.createElement('div');
    label.className = 'cat-label';
    label.textContent = catNames[cat];
    panel.appendChild(label);

    const row = document.createElement('div');
    row.className = 'btn-row';
    items.forEach(action => {
      const btn = document.createElement('div');
      btn.className = 'key-btn';
      btn.dataset.player = player.id;
      btn.dataset.key = action.key;
      const keyDisp = action.key.replace('Space', '\u2423');
      btn.innerHTML = `<span class="key-label">${keyDisp}</span><span class="key-value">${action.label}</span>`;
      btn.addEventListener('mousedown', () => {
        player.play(action.anim);
        setActiveBtn(player.id, action.key, activeClass);
      });
      row.appendChild(btn);
    });
    panel.appendChild(row);
  });
}

export function setPanelVisibility(panelId, visible) {
  const panel = document.getElementById(panelId);
  if (!panel) return;
  if (!visible) {
    panel.style.display = 'none';
    return;
  }
  panel.style.display = '';
}

export function setActiveBtn(playerId, key, activeClass) {
  document.querySelectorAll(`.key-btn[data-player="${playerId}"]`).forEach(b => {
    b.classList.remove('active-p1', 'active-p2');
  });
  if (key) {
    const btn = document.querySelector(`.key-btn[data-player="${playerId}"][data-key="${key}"]`);
    if (btn) btn.classList.add(activeClass);
  }
}

// ── Loading / Game UI visibility ──

export function hideLoading() {
  document.getElementById('loading').style.display = 'none';
}

export function showGameUI() {
  initMobileFightUi();
  initTrainDetailsUi();
  resetFightOverlays();
  document.getElementById('ui').style.display = 'block';
}

// ── Splash screen ──

let assetsLoaded = false;

export function markAssetsLoaded() {
  assetsLoaded = true;
}

export function showSplash() {
  return new Promise((resolve) => {
    const splash = document.getElementById('splash-screen');
    splash.style.display = '';
    document.getElementById('splash-start').onclick = () => {
      splash.style.display = 'none';
      // Only show loading on first boot, not when returning from menus
      if (!assetsLoaded) {
        document.getElementById('loading').style.display = '';
      }
      resolve();
    };
  });
}

export function showSplashFromBack() {
  // No-op; showSplash will re-display it
}

// ── Mode select ──

export function showModeSelect() {
  return new Promise((resolve, reject) => {
    const overlay = document.getElementById('mode-select');
    overlay.style.display = '';

    // Back button -> splash
    const backBtn = document.getElementById('mode-back');
    if (backBtn) {
      backBtn.onclick = () => {
        overlay.style.display = 'none';
        reject('back-to-splash');
      };
    }

    overlay.querySelectorAll('.mode-btn').forEach(btn => {
      btn.onclick = () => {
        overlay.style.display = 'none';
        resolve(btn.dataset.mode);
      };
    });
  });
}

// ── Difficulty select ──

export function showDifficultySelect(difficulties) {
  return new Promise((resolve, reject) => {
    const overlay = document.getElementById('difficulty-select');
    overlay.style.display = '';
    const container = overlay.querySelector('.diff-buttons');
    container.innerHTML = '';

    // Back button -> mode select
    const backBtn = document.getElementById('diff-back');
    if (backBtn) {
      backBtn.onclick = () => {
        overlay.style.display = 'none';
        reject('back-to-mode');
      };
    }

    for (const [key, diff] of Object.entries(difficulties)) {
      const btn = document.createElement('button');
      btn.className = 'diff-btn';
      btn.dataset.diff = key;
      btn.style.borderColor = diff.color;
      btn.innerHTML = `<span class="diff-name" style="color:${diff.color}">${diff.name}</span><span class="diff-desc">${diff.description}</span>`;
      btn.onclick = () => {
        overlay.style.display = 'none';
        resolve(key);
      };
      container.appendChild(btn);
    }
  });
}

// ── Pixel-art sprite generator ──

// Each sprite is a 12x12 grid, each cell = 1 = filled with class color, 2 = skin, 3 = dark accent
const SPRITES = {
  boxer: [
    '000022220000',
    '000022220000',
    '000022220000',
    '001111111100',
    '121111111121',
    '122111111221',
    '001111111100',
    '000111111000',
    '000011110000',
    '000011110000',
    '000011011000',
    '000033033000',
  ],
  mma: [
    '000022220000',
    '000022220000',
    '000022220000',
    '001111111100',
    '021111111120',
    '001111111100',
    '000111111000',
    '000011110000',
    '000011110000',
    '000011110000',
    '000011011000',
    '000033033000',
  ],
  street: [
    '000022220000',
    '000022220000',
    '000022220000',
    '001111111100',
    '001111111100',
    '001111111100',
    '001111111100',
    '001111111100',
    '000011110000',
    '000011110000',
    '000011011000',
    '000033033000',
  ],
  agent: [
    '000022220000',
    '000022220000',
    '000022220000',
    '000111111000',
    '001111111100',
    '001111111100',
    '001111111100',
    '000111111000',
    '000011110000',
    '000011110000',
    '000011011000',
    '000033033000',
  ],
};

function renderSprite(classId, color) {
  const canvas = document.createElement('canvas');
  canvas.width = 12;
  canvas.height = 12;
  canvas.className = 'pixel-sprite';
  const ctx = canvas.getContext('2d');

  const grid = SPRITES[classId];
  if (!grid) return canvas;

  // Parse the hex color for the class tint
  const r = parseInt(color.slice(1, 3), 16);
  const g = parseInt(color.slice(3, 5), 16);
  const b = parseInt(color.slice(5, 7), 16);

  for (let y = 0; y < 12; y++) {
    for (let x = 0; x < 12; x++) {
      const c = grid[y][x];
      if (c === '0') continue; // transparent
      if (c === '1') ctx.fillStyle = color;                         // class color (body/armor)
      else if (c === '2') ctx.fillStyle = '#ffccaa';                // skin tone
      else if (c === '3') ctx.fillStyle = `rgb(${r>>1},${g>>1},${b>>1})`; // dark accent
      ctx.fillRect(x, y, 1, 1);
    }
  }

  return canvas;
}

// ── Class select overlay ──

export function showClassSelect(gameMode = '2p') {
  return new Promise((resolve, reject) => {
    const overlay = document.getElementById('class-select');
    overlay.style.display = '';
    const fightBtn = document.getElementById('fight-btn');
    fightBtn.disabled = true;

    // Back button -> difficulty (1p) or mode (2p/train)
    const backBtn = document.getElementById('class-back');
    if (backBtn) {
      backBtn.onclick = () => {
        overlay.style.display = 'none';
        reject(gameMode === '1p' ? 'back-to-difficulty' : 'back-to-mode');
      };
    }

    let p1Class = null, p2Class = null;

    const classIds = Object.keys(CLASS_DEFS);

    // Update column headers for mode
    const h3p2 = overlay.querySelector('.col-p2 h3');
    if (h3p2) h3p2.textContent = gameMode === '1p' ? 'AI Opponent' : 'Player 2 (Arrows)';

    ['p1', 'p2'].forEach(pid => {
      const col = overlay.querySelector(`.col-${pid}`);
      col.querySelectorAll('.class-card').forEach(c => c.remove());

      classIds.forEach(cid => {
        const def = CLASS_DEFS[cid];
        const card = document.createElement('div');
        card.className = 'class-card';
        card.dataset.classId = cid;
        card.style.setProperty('--sel-color', def.color);
        card.style.setProperty('--sel-glow', def.color + '44');

        // Pixel sprite
        const sprite = renderSprite(cid, def.color);
        card.appendChild(sprite);

        // Text
        card.insertAdjacentHTML('beforeend', `
          <div class="class-name" style="color:${def.color}">${def.name}</div>
          <div class="class-desc">${def.description}</div>
          <div class="class-stats">HP ${def.stats.maxHealth}  SPD ${def.stats.walkSpeed}  RUN ${def.stats.sprintSpeed}</div>
          <div class="hp-preview"><div class="hp-fill" style="width:${def.stats.maxHealth}%"></div></div>
        `);

        card.addEventListener('click', () => {
          col.querySelectorAll('.class-card').forEach(c => c.classList.remove('selected'));
          card.classList.add('selected');
          if (pid === 'p1') p1Class = cid; else p2Class = cid;
          fightBtn.disabled = !(p1Class && p2Class);
        });
        col.appendChild(card);
      });
    });

    fightBtn.onclick = () => {
      if (!p1Class || !p2Class) return;
      overlay.style.display = 'none';
      resolve({ p1Class, p2Class });
    };
  });
}

// ── Training Dashboard ──

let graphCanvas = null;
let graphCtx = null;

export function showTrainingDashboard(show) {
  const dash = document.getElementById('training-dash');
  if (dash) dash.style.display = show ? 'flex' : 'none';
  if (!show) setTrainDetailsOpen(false);
  if (show && !graphCanvas) {
    graphCanvas = document.getElementById('train-graph');
    if (graphCanvas) graphCtx = graphCanvas.getContext('2d');
  }
}

export function updateSpeedDisplay(speed) {
  const el = document.getElementById('speed-val');
  if (el) el.textContent = formatSpeed(speed);
}

function formatSpeed(speed) {
  if (Number.isInteger(speed)) return speed + 'x';
  return speed.toFixed(2).replace(/0+$/, '').replace(/\.$/, '') + 'x';
}

function winColor(wr) {
  const v = parseFloat(wr);
  if (v >= 55) return 'good';
  if (v <= 45) return 'bad';
  return 'mid';
}

export function updateTrainingStats(ai1, ai2, rounds, speed, ghostRounds = 0) {
  const el = document.getElementById('train-stats');
  if (!el) return;

  const s1 = ai1?.brain?.getStats() || {};
  const s2 = ai2?.brain?.getStats() || {};

  el.innerHTML = `
    <div class="ts-row"><span class="ts-label">VISIBLE</span><span class="ts-val">${rounds - ghostRounds}</span></div>
    <div class="ts-row"><span class="ts-label">GHOST</span><span class="ts-val" style="color:#80ff80">${ghostRounds}</span></div>
    <div class="ts-row"><span class="ts-label">TOTAL</span><span class="ts-val" style="color:#ffcc40">${rounds}</span></div>
    <div class="ts-row"><span class="ts-label">SPEED</span><span class="ts-val">${formatSpeed(speed)}</span></div>
    <div class="ts-divider"></div>
    <div class="ts-header" style="color:#4090ff">AI-1 (BLUE)</div>
    <div class="ts-row"><span class="ts-label">W / L</span><span class="ts-val">${s1.wins||0} / ${s1.losses||0}</span></div>
    <div class="ts-row"><span class="ts-label">RECENT WIN%</span><span class="ts-val ts-${winColor(s1.winRate)}">${s1.winRate||0}%</span></div>
    <div class="ts-row"><span class="ts-label">OVERALL WIN%</span><span class="ts-val">${s1.cumulativeWr||0}%</span></div>
    <div class="ts-row"><span class="ts-label">AVG DMG</span><span class="ts-val">${s1.avgDmg||0}/rnd</span></div>
    <div class="ts-row"><span class="ts-label">RANDOM%</span><span class="ts-val">${s1.epsilon||0}%</span></div>
    <div class="ts-row"><span class="ts-label">KNOWLEDGE</span><span class="ts-val">${s1.statesExplored||0} states</span></div>
    <div class="ts-divider"></div>
    <div class="ts-header" style="color:#ff4040">AI-2 (RED)</div>
    <div class="ts-row"><span class="ts-label">W / L</span><span class="ts-val">${s2.wins||0} / ${s2.losses||0}</span></div>
    <div class="ts-row"><span class="ts-label">RECENT WIN%</span><span class="ts-val ts-${winColor(s2.winRate)}">${s2.winRate||0}%</span></div>
    <div class="ts-row"><span class="ts-label">OVERALL WIN%</span><span class="ts-val">${s2.cumulativeWr||0}%</span></div>
    <div class="ts-row"><span class="ts-label">AVG DMG</span><span class="ts-val">${s2.avgDmg||0}/rnd</span></div>
    <div class="ts-row"><span class="ts-label">RANDOM%</span><span class="ts-val">${s2.epsilon||0}%</span></div>
    <div class="ts-row"><span class="ts-label">KNOWLEDGE</span><span class="ts-val">${s2.statesExplored||0} states</span></div>
  `;
}

export function updateGraph(ai1, ai2) {
  if (!graphCtx || !graphCanvas) return;
  const ctx = graphCtx;
  const w = graphCanvas.width;
  const h = graphCanvas.height;
  const halfH = h / 2;

  ctx.fillStyle = '#0a0a18';
  ctx.fillRect(0, 0, w, h);

  // --- Top half: Rolling win rate (last 20) ---
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, w, halfH);
  ctx.clip();

  // Grid
  ctx.strokeStyle = '#1a1a30';
  ctx.lineWidth = 1;
  for (let y = 0; y <= halfH; y += halfH / 4) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
  }

  // 50% baseline
  ctx.strokeStyle = '#333';
  ctx.setLineDash([3, 3]);
  ctx.beginPath(); ctx.moveTo(0, halfH / 2); ctx.lineTo(w, halfH / 2); ctx.stroke();
  ctx.setLineDash([]);

  // Rolling win rate lines (0-100% mapped to halfH-0)
  drawLine(ctx, ai1?.brain?.rollingWinRate || [], '#4090ff', w, halfH, 200);
  drawLine(ctx, ai2?.brain?.rollingWinRate || [], '#ff4040', w, halfH, 200);

  ctx.font = '7px "Press Start 2P", monospace';
  ctx.fillStyle = '#4090ff'; ctx.fillText('AI-1', 4, 10);
  ctx.fillStyle = '#ff4040'; ctx.fillText('AI-2', 4, 20);
  ctx.fillStyle = '#555'; ctx.fillText('WIN% (last 20)', w - 115, 10);
  ctx.fillStyle = '#333'; ctx.fillText('50%', w - 28, halfH / 2 + 3);
  ctx.fillStyle = '#2a2a40'; ctx.fillText('100%', w - 38, 10);
  ctx.fillStyle = '#2a2a40'; ctx.fillText('0%', w - 20, halfH - 3);

  ctx.restore();

  // --- Bottom half: Avg damage dealt (rolling 20) ---
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, halfH, w, halfH);
  ctx.clip();

  // Divider
  ctx.strokeStyle = '#2a2a50';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, halfH); ctx.lineTo(w, halfH); ctx.stroke();

  // Grid
  ctx.strokeStyle = '#1a1a30';
  for (let y = halfH; y <= h; y += halfH / 3) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
  }

  // Damage lines (auto-scale)
  const dmg1 = ai1?.brain?.avgDmgDealtHistory || [];
  const dmg2 = ai2?.brain?.avgDmgDealtHistory || [];
  const allDmg = [...dmg1, ...dmg2];
  const maxDmg = allDmg.length > 0 ? Math.max(...allDmg, 50) : 200;

  drawLineScaled(ctx, dmg1, '#4090ff', w, halfH, h, maxDmg, 200);
  drawLineScaled(ctx, dmg2, '#ff4040', w, halfH, h, maxDmg, 200);

  ctx.font = '7px "Press Start 2P", monospace';
  ctx.fillStyle = '#555'; ctx.fillText('AVG DMG/RND', w - 100, halfH + 12);
  ctx.fillStyle = '#2a2a40'; ctx.fillText(Math.round(maxDmg) + '', w - 25, halfH + 12);
  ctx.fillStyle = '#2a2a40'; ctx.fillText('0', w - 10, h - 3);

  ctx.restore();
}

/** Draw a 0-1 normalized line in a region */
function drawLine(ctx, data, color, w, h, maxVisible) {
  if (data.length < 2) return;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  const start = Math.max(0, data.length - maxVisible);
  const visible = data.slice(start);
  for (let i = 0; i < visible.length; i++) {
    const x = (i / Math.max(visible.length - 1, 1)) * w;
    const y = h - Math.max(0, Math.min(1, visible[i])) * h;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

/** Draw an auto-scaled line in a vertical region [yTop, yBot] */
function drawLineScaled(ctx, data, color, w, yTop, yBot, maxVal, maxVisible) {
  if (data.length < 2) return;
  const regionH = yBot - yTop;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  const start = Math.max(0, data.length - maxVisible);
  const visible = data.slice(start);
  for (let i = 0; i < visible.length; i++) {
    const x = (i / Math.max(visible.length - 1, 1)) * w;
    const norm = Math.max(0, Math.min(1, visible[i] / maxVal));
    const y = yBot - norm * regionH;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();
}
