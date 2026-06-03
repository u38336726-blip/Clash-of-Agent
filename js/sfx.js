let audioCtx = null;
let masterGain = null;
let sfxGain = null;
let noiseBuffer = null;

const lastSoundAt = {
  impact: -Infinity,
  swing: -Infinity,
};

const SOUND_GAPS = {
  impact: 0.055,
  swing: 0.09,
};

const KICK_SWINGS = new Set(['Kick_Front', 'Kick_Round', 'Kick_MMA', 'Kick_Side']);
const HEAVY_SWINGS = new Set(['Hook', 'Hook_Right', 'Uppercut', 'Uppercut_Combo', 'Counter', 'Elbow']);
const PUNCH_SWINGS = new Set([
  'Jab', 'Cross', 'Body_Punch', 'Body_Punch_L',
  'Hook', 'Hook_Right', 'Uppercut', 'Uppercut_Combo',
  'Counter', 'Elbow',
]);

function getAudioContext() {
  if (audioCtx || typeof window === 'undefined') return audioCtx;
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return null;
  audioCtx = new Ctor();
  ensureAudioGraph(audioCtx);
  return audioCtx;
}

function ensureAudioGraph(ctx) {
  if (masterGain) return;

  masterGain = ctx.createGain();
  masterGain.gain.value = 0.82;

  sfxGain = ctx.createGain();
  sfxGain.gain.value = 1.0;

  const compressor = ctx.createDynamicsCompressor();
  compressor.threshold.value = -18;
  compressor.knee.value = 18;
  compressor.ratio.value = 3;
  compressor.attack.value = 0.003;
  compressor.release.value = 0.18;

  sfxGain.connect(compressor);
  compressor.connect(masterGain);
  masterGain.connect(ctx.destination);
}

function getNoiseBuffer(ctx) {
  if (noiseBuffer) return noiseBuffer;
  const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.35), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) {
    const fade = 1 - i / data.length;
    data[i] = (Math.random() * 2 - 1) * fade;
  }
  noiseBuffer = buffer;
  return buffer;
}

function shapeGain(node, startTime, peak, attack, release) {
  node.gain.cancelScheduledValues(startTime);
  node.gain.setValueAtTime(0.0001, startTime);
  node.gain.linearRampToValueAtTime(peak, startTime + attack);
  node.gain.exponentialRampToValueAtTime(0.0001, startTime + attack + release);
}

function canPlayNow(kind) {
  const ctx = getAudioContext();
  if (!ctx) return null;
  ensureAudioGraph(ctx);
  if (ctx.state !== 'running') {
    ctx.resume().catch(() => {});
    return null;
  }

  const now = ctx.currentTime;
  const gap = SOUND_GAPS[kind] ?? 0;
  if (now - (lastSoundAt[kind] ?? -Infinity) < gap) return null;
  lastSoundAt[kind] = now;
  return ctx;
}

function createTone(ctx, {
  time,
  freq,
  endFreq = freq,
  peak = 0.04,
  attack = 0.004,
  release = 0.08,
  type = 'triangle',
  lowpass = 3600,
}) {
  const gain = ctx.createGain();
  shapeGain(gain, time, peak, attack, release);

  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(lowpass, time);

  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, time);
  osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), time + attack + release);

  osc.connect(filter);
  filter.connect(gain);
  gain.connect(sfxGain);
  osc.start(time);
  osc.stop(time + attack + release + 0.03);
}

function createNoiseSource(ctx, frequency, peak, startTime, duration, q = 0.9) {
  const noise = ctx.createBufferSource();
  noise.buffer = getNoiseBuffer(ctx);

  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(frequency, startTime);
  filter.Q.value = q;

  const gain = ctx.createGain();
  shapeGain(gain, startTime, peak, 0.002, duration);

  noise.connect(filter);
  filter.connect(gain);
  gain.connect(sfxGain);
  noise.start(startTime);
  noise.stop(startTime + duration + 0.02);
}

function playBurst({ peak, baseFreq, endFreq, noiseFreq, duration, kind = 'impact', toneType = 'triangle', noisePeak = null }) {
  const ctx = canPlayNow(kind);
  if (!ctx) return;

  const time = ctx.currentTime;
  createTone(ctx, {
    time,
    freq: baseFreq,
    endFreq,
    peak,
    release: duration,
    type: toneType,
    lowpass: 3200,
  });

  createNoiseSource(
    ctx,
    noiseFreq,
    noisePeak ?? peak * 0.7,
    time,
    duration * 0.6,
    0.7
  );
}

export function unlockAudio() {
  const ctx = getAudioContext();
  if (ctx && ctx.state !== 'running') {
    ctx.resume().catch(() => {});
  }
}

export function setAudioScene() {}

export function playUiSelectSound() {}

export function playRoundStartSound() {}

export function playAttackSwingSound(animName) {
  if (animName === 'Block_Loop') {
    const ctx = canPlayNow('swing');
    if (!ctx) return;
    const time = ctx.currentTime;
    createTone(ctx, {
      time,
      freq: 240,
      endFreq: 160,
      peak: 0.02,
      attack: 0.002,
      release: 0.08,
      type: 'triangle',
      lowpass: 1800,
    });
    createNoiseSource(ctx, 1200, 0.01, time, 0.05, 1.1);
    return;
  }

  if (!KICK_SWINGS.has(animName) && !PUNCH_SWINGS.has(animName)) return;

  const kick = KICK_SWINGS.has(animName);
  const heavy = HEAVY_SWINGS.has(animName);
  playBurst({
    peak: kick ? 0.042 : heavy ? 0.032 : 0.026,
    baseFreq: kick ? 320 : heavy ? 420 : 600,
    endFreq: kick ? 95 : heavy ? 150 : 220,
    noiseFreq: kick ? 760 : heavy ? 1050 : 1500,
    duration: kick ? 0.12 : heavy ? 0.1 : 0.075,
    kind: 'swing',
    toneType: kick ? 'triangle' : 'sawtooth',
    noisePeak: kick ? 0.024 : 0.016,
  });
}

export function playDodgeSound() {}

export function playHitSound(power = 1) {
  playBurst({
    peak: 0.08 + Math.min(0.08, power * 0.003),
    baseFreq: 180 + power * 2.2,
    endFreq: 55 + power * 0.4,
    noiseFreq: 880 + power * 9,
    duration: 0.08 + Math.min(0.05, power * 0.0015),
    kind: 'impact',
    toneType: power > 17 ? 'sawtooth' : 'triangle',
  });
}

export function playBlockSound() {
  playHitSound(10);
}

export function playKoSound() {}
