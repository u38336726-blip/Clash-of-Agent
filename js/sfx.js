let audioCtx = null;
let noiseBuffer = null;
let lastImpactSoundAt = -Infinity;
let lastKoSoundAt = -Infinity;

const IMPACT_SOUND_MIN_GAP = 0.055;
const KO_SOUND_MIN_GAP = 0.2;

function getAudioContext() {
  if (audioCtx || (typeof window === 'undefined')) return audioCtx;
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return null;
  audioCtx = new Ctor();
  return audioCtx;
}

function getNoiseBuffer(ctx) {
  if (noiseBuffer) return noiseBuffer;
  const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.2), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
  }
  noiseBuffer = buffer;
  return buffer;
}

function shapeGain(node, startTime, peak, attack, release) {
  node.gain.setValueAtTime(0.0001, startTime);
  node.gain.linearRampToValueAtTime(peak, startTime + attack);
  node.gain.exponentialRampToValueAtTime(0.0001, startTime + attack + release);
}

export function unlockAudio() {
  const ctx = getAudioContext();
  if (ctx && ctx.state !== 'running') {
    ctx.resume().catch(() => {});
  }
}

function canPlayNow(kind) {
  const ctx = getAudioContext();
  if (!ctx) return null;
  if (ctx.state !== 'running') {
    ctx.resume().catch(() => {});
    return null;
  }

  const now = ctx.currentTime;
  if (kind === 'impact') {
    if (now - lastImpactSoundAt < IMPACT_SOUND_MIN_GAP) return null;
    lastImpactSoundAt = now;
  } else if (kind === 'ko') {
    if (now - lastKoSoundAt < KO_SOUND_MIN_GAP) return null;
    lastKoSoundAt = now;
  }

  return ctx;
}

function playBurst({ peak, baseFreq, endFreq, noiseFreq, duration, kind = 'impact' }) {
  const ctx = canPlayNow(kind);
  if (!ctx) return;

  const t = ctx.currentTime;
  const out = ctx.createGain();
  shapeGain(out, t, peak, 0.004, duration);
  out.connect(ctx.destination);

  const osc = ctx.createOscillator();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(baseFreq, t);
  osc.frequency.exponentialRampToValueAtTime(endFreq, t + duration);
  osc.connect(out);
  osc.start(t);
  osc.stop(t + duration + 0.02);

  const noise = ctx.createBufferSource();
  noise.buffer = getNoiseBuffer(ctx);
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(noiseFreq, t);
  filter.Q.value = 0.7;
  const noiseGain = ctx.createGain();
  shapeGain(noiseGain, t, peak * 0.7, 0.002, duration * 0.55);
  noise.connect(filter);
  filter.connect(noiseGain);
  noiseGain.connect(ctx.destination);
  noise.start(t);
  noise.stop(t + duration * 0.6);
}

export function playHitSound(power = 1) {
  playBurst({
    peak: 0.08 + Math.min(0.08, power * 0.003),
    baseFreq: 180 + power * 2.2,
    endFreq: 55 + power * 0.4,
    noiseFreq: 880 + power * 9,
    duration: 0.08 + Math.min(0.05, power * 0.0015),
    kind: 'impact',
  });
}

export function playBlockSound() {
  playHitSound(10);
}

export function playKoSound() {
  playBurst({
    peak: 0.12,
    baseFreq: 120,
    endFreq: 42,
    noiseFreq: 520,
    duration: 0.18,
    kind: 'ko',
  });
}
