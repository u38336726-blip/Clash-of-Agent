import * as THREE from 'three';

// Persistent key state
const keyState = {};

let p1MoveAnim = null;
let p2MoveAnim = null;
let _gameMode = '2p';

/**
 * Wire up keyboard listeners and bind ability keys to players.
 * @param {string} gameMode - '1p' or '2p'
 */
export function initControls(player1, player2, p1Actions, p2Actions, ui, gameMode = '2p') {
  _gameMode = gameMode;

  window.addEventListener('keydown', (e) => {
    const k = e.key;
    keyState[k] = true;

    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(k)) {
      e.preventDefault();
    }
    if (e.repeat) return;

    // P1 ability keys
    const matchP1 = k === ' ' ? 'Space' : k.toUpperCase();
    const a1 = p1Actions.find(a => a.key === matchP1);
    if (a1) {
      player1.play(a1.anim);
      ui.setActiveBtn('p1', a1.key, 'active-p1');
    }

    // P2 ability keys (only in 2P mode)
    if (_gameMode === '2p') {
      const matchP2 = k.toUpperCase();
      const a2 = p2Actions.find(a => a.key === matchP2);
      if (a2) {
        player2.play(a2.anim);
        ui.setActiveBtn('p2', a2.key, 'active-p2');
      }
    }
  });

  window.addEventListener('keyup', (e) => {
    keyState[e.key] = false;
  });
}

/**
 * Call every frame — reads held movement keys and moves players.
 */
export function processMovement(dt, player1, player2) {
  // In training mode, AI handles all movement
  if (_gameMode === 'train') return;

  // --- Player 1: WASD ---
  let p1dx = 0, p1dz = 0;
  if (keyState['w'] || keyState['W']) p1dz -= 1;
  if (keyState['s'] || keyState['S']) p1dz += 1;
  if (keyState['a'] || keyState['A']) p1dx -= 1;
  if (keyState['d'] || keyState['D']) p1dx += 1;

  const p1Moving = p1dx !== 0 || p1dz !== 0;
  const p1Sprint = keyState['Shift'];
  const p1Speed = p1Sprint ? player1.sprintSpeed : player1.walkSpeed;

  if (p1Moving && !player1.isStunned && !player1.gameOver) {
    player1.move(p1dx, p1dz, p1Speed, dt, player2);

    const toOpp = player2.model && player1.model
      ? new THREE.Vector3().subVectors(player2.model.position, player1.model.position).normalize()
      : new THREE.Vector3(1, 0, 0);
    const moveDir = new THREE.Vector3(p1dx, 0, p1dz).normalize();
    const dot = toOpp.dot(moveDir);

    let anim;
    if (p1Sprint)        anim = 'Sprint_Loop';
    else if (dot > 0.5)  anim = 'Walk_Loop';
    else if (dot < -0.5) anim = 'Walk_Back_Loop';
    else                 anim = 'Walk_Loop';

    if (p1MoveAnim !== anim) {
      p1MoveAnim = anim;
      player1.play(anim, 0.2);
    }
  } else {
    if (p1MoveAnim) {
      p1MoveAnim = null;
      if (!player1.isStunned && !player1.gameOver) player1.play('Idle_Loop', 0.3);
    }
    player1.clearMovement();
  }

  // --- Player 2: Arrow keys (only in 2P mode; AI handles P2 in 1P) ---
  if (_gameMode === '2p') {
    let p2dx = 0, p2dz = 0;
    if (keyState['ArrowUp'])    p2dz -= 1;
    if (keyState['ArrowDown'])  p2dz += 1;
    if (keyState['ArrowLeft'])  p2dx -= 1;
    if (keyState['ArrowRight']) p2dx += 1;

    const p2Moving = p2dx !== 0 || p2dz !== 0;
    const p2Sprint = keyState['Shift'];
    const p2Speed = p2Sprint ? player2.sprintSpeed : player2.walkSpeed;

    if (p2Moving && !player2.isStunned && !player2.gameOver) {
      player2.move(p2dx, p2dz, p2Speed, dt, player1);

      const toOpp = player1.model && player2.model
        ? new THREE.Vector3().subVectors(player1.model.position, player2.model.position).normalize()
        : new THREE.Vector3(-1, 0, 0);
      const moveDir = new THREE.Vector3(p2dx, 0, p2dz).normalize();
      const dot = toOpp.dot(moveDir);

      let anim;
      if (p2Sprint)        anim = 'Sprint_Loop';
      else if (dot > 0.5)  anim = 'Walk_Loop';
      else if (dot < -0.5) anim = 'Walk_Back_Loop';
      else                 anim = 'Walk_Loop';

      if (p2MoveAnim !== anim) {
        p2MoveAnim = anim;
        player2.play(anim, 0.2);
      }
    } else {
      if (p2MoveAnim) {
        p2MoveAnim = null;
        if (!player2.isStunned && !player2.gameOver) player2.play('Idle_Loop', 0.3);
      }
      player2.clearMovement();
    }
  }
}
