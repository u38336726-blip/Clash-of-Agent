let audioCtx = null;
let masterGain = null;
let sfxGain = null;
let musicGain = null;
let noiseBuffer = null;
let musicTimer = null;
let musicScene = 'menu';
let musicStep = 0;
let nextMusicStepAt = 0;

const lastSoundAt = {
  impact: -Infinity,
  ko: -Infinity,
  swing: -Infinity,
  dodge: -Infinity,
  ui: -Infinity,
  stinger: -Infinity,
};

const SOUND_GAPS = {
  impact: 0.055,
  ko: 0.2,
  swing: 0.09,
  dodge: 0.14,
  ui: 0.045,
  stinger: 0.25,
};

const KICK_SWINGS = new Set(['Kick_Front', 'Kick_Round', 'Kick_MMA', 'Kick_Side']);
const HEAVY_SWINGS = new Set(['Hook', 'Hook_Right', 'Uppercut', 'Uppercut_Combo', 'Counter', 'Elbow']);
const PUNCH_SWINGS = new Set([
  'Jab', 'Cross', 'Body_Punch', 'Body_Punch_L',
  'Hook', 'Hook_Right', 'Uppercut', 'Uppercut_Combo',
  'Counter', 'Elbow',
]);

const MUSIC_SCENES = {
  menu: {
    tempo: 96,
    rootMidi: 50,
    gain: 0.17,
    bass: [0, 7, 10, 7, 3, 10, 12, 7],
    lead: [12, 15, 17, 15, 10, 12, 15, 19],
    tick: false,
  },
  fight: {
    tempo: 124,
    rootMidi: 43,
    gain: 0.15,
    bass: [0, 0, 3, 0, 7, 3, 0, 10],
    lead: [12, null, 15, null, 17, 15, 12, 10],
    tick: true,
  },
  train: {
    tempo: 112,
    rootMidi: 45,
    gain: 0.12,
    bass: [0, 5, 7, 10, 7, 5, 3, 0],
    lead: [12, null, 10, null, 15, null, 12, null],
    tick: true,
  },
  ko: {
    tempo: 72,
    rootMidi: 38,
    gain: 0.11,
    bass: [0, null, -2, null, -5, null, -7, null],
    lead: [12, null, 10, null, 8, null, 7, null],
    tick: false,
  },
};

function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

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

  musicGain = ctx.createGain();
  musicGain.gain.value = MUSIC_SCENES[musicScene].gain;

  const musicFilter = ctx.createBiquadFilter();
  musicFilter.type = 'lowpass';
  musicFilter.frequency.value = 4200;
  musicFilter.Q.value = 0.15;

  const compressor = ctx.createDynamicsCompressor();
  compressor.threshold.value = -18;
  compressor.knee.value = 18;
  compressor.ratio.value = 3;
  compressor.attack.value = 0.003;
  compressor.release.value = 0.18;

  musicGain.connect(musicFilter);
  musicFilter.connect(compressor);
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

function createNoiseSource(ctx, frequency, peak, startTime, duration, destination, q = 0.9) {
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
  gain.connect(destination);
  noise.start(startTime);
  noise.stop(startTime + duration + 0.02);
}

function createTone(ctx, {
  destination,
  time,
  freq,
  endFreq = freq,
  peak = 0.04,
  attack = 0.004,
  release = 0.08,
  type = 'triangle',
  detune = 0,
  lowpass = 4800,
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
  osc.detune.value = detune;

  osc.connect(filter);
  filter.connect(gain);
  gain.connect(destination);
  osc.start(time);
  osc.stop(time + attack + release + 0.03);
}

function playBurst({ peak, baseFreq, endFreq, noiseFreq, duration, kind = 'impact', toneType = 'triangle', noisePeak = null }) {
  const ctx = canPlayNow(kind);
  if (!ctx) return;

  const time = ctx.currentTime;
  createTone(ctx, {
    destination: sfxGain,
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
    sfxGain,
    0.7
  );
}

function ensureMusicLoop() {
  if (musicTimer || typeof window === 'undefined') return;
  musicTimer = window.setInterval(() => {
    const ctx = getAudioContext();
    if (!ctx || ctx.state !== 'running') return;
    scheduleMusic();
  }, 90);
}

function scheduleMusic() {
  const ctx = getAudioContext();
  if (!ctx || !musicGain) return;

  const scene = MUSIC_SCENES[musicScene] || MUSIC_SCENES.menu;
  musicGain.gain.setTargetAtTime(scene.gain, ctx.currentTime, 0.08);

  const stepDuration = 60 / scene.tempo / 2;
  if (!nextMusicStepAt || nextMusicStepAt < ctx.currentTime - stepDuration) {
    nextMusicStepAt = ctx.currentTime + 0.02;
  }

  while (nextMusicStepAt < ctx.currentTime + 0.24) {
    scheduleSceneStep(ctx, scene, musicStep, nextMusicStepAt, stepDuration);
    nextMusicStepAt += stepDuration;
    musicStep = (musicStep + 1) % scene.bass.length;
  }
}

function scheduleSceneStep(ctx, scene, step, time, stepDuration) {
  const bassSemi = scene.bass[step % scene.bass.length];
  if (bassSemi !== null && bassSemi !== undefined) {
    createTone(ctx, {
      destination: musicGain,
      time,
      freq: midiToFreq(scene.rootMidi + bassSemi),
      endFreq: midiToFreq(scene.rootMidi + bassSemi - 0.2),
      peak: musicScene === 'fight' ? 0.05 : 0.04,
      attack: 0.006,
      release: stepDuration * 0.8,
      type: musicScene === 'menu' ? 'triangle' : 'sawtooth',
      lowpass: musicScene === 'ko' ? 1600 : 2600,
    });
  }

  const leadSemi = scene.lead[step % scene.lead.length];
  if (leadSemi !== null && leadSemi !== undefined) {
    createTone(ctx, {
      destination: musicGain,
      time: time + stepDuration * 0.04,
      freq: midiToFreq(scene.rootMidi + leadSemi),
      endFreq: midiToFreq(scene.rootMidi + leadSemi + 0.1),
      peak: musicScene === 'menu' ? 0.026 : 0.022,
      attack: 0.01,
      release: stepDuration * 0.55,
      type: musicScene === 'ko' ? 'triangle' : 'square',
      detune: step % 2 === 0 ? -5 : 5,
      lowpass: 3600,
    });
  }

  if (scene.tick && step % 2 === 1) {
    createNoiseSource(ctx, 2200, 0.006, time, stepDuration * 0.25, musicGain, 1.3);
  }

  if (step % 4 === 0) {
    const chord = [
      midiToFreq(scene.rootMidi + 12),
      midiToFreq(scene.rootMidi + 19),
      midiToFreq(scene.rootMidi + 24),
    ];
    chord.forEach((freq, i) => {
      createTone(ctx, {
        destination: musicGain,
        time: time + i * 0.004,
        freq,
        endFreq: freq * 0.998,
        peak: 0.012,
        attack: 0.02,
        release: stepDuration * 1.9,
        type: 'triangle',
        detune: i === 1 ? 4 : 0,
        lowpass: 2200,
      });
    });
  }
}

export function unlockAudio() {
  const ctx = getAudioContext();
  if (!ctx) return;
  ensureAudioGraph(ctx);
  if (ctx.state !== 'running') {
    ctx.resume().catch(() => {});
  }
  ensureMusicLoop();
  if (!nextMusicStepAt) nextMusicStepAt = ctx.currentTime + 0.02;
}

export function setAudioScene(scene) {
  musicScene = MUSIC_SCENES[scene] ? scene : 'menu';
  if (!audioCtx) return;
  ensureAudioGraph(audioCtx);
  ensureMusicLoop();
  musicStep = 0;
  nextMusicStepAt = audioCtx.currentTime + 0.02;
}

export function playUiSelectSound(kind = 'select') {
  const ctx = canPlayNow('ui');
  if (!ctx) return;

  const time = ctx.currentTime;
  const profiles = {
    select: { notes: [74, 81], peak: 0.022, release: 0.05, type: 'square' },
    confirm: { notes: [71, 76, 83], peak: 0.028, release: 0.06, type: 'square' },
    back: { notes: [76, 71], peak: 0.022, release: 0.055, type: 'triangle' },
    toggle: { notes: [69, 74], peak: 0.02, release: 0.05, type: 'square' },
  };
  const profile = profiles[kind] || profiles.select;

  profile.notes.forEach((midi, index) => {
    createTone(ctx, {
      destination: sfxGain,
      time: time + index * 0.035,
      freq: midiToFreq(midi),
      endFreq: midiToFreq(midi - 0.2),
      peak: profile.peak,
      attack: 0.003,
      release: profile.release,
      type: profile.type,
      lowpass: 4200,
    });
  });
}

export function playRoundStartSound(mode = 'fight') {
  const ctx = canPlayNow('stinger');
  if (!ctx) return;

  const time = ctx.currentTime;
  const root = mode === 'train' ? 57 : 60;
  const notes = mode === 'train' ? [root, root + 5, root + 9] : [root, root + 7, root + 12];

  notes.forEach((midi, index) => {
    createTone(ctx, {
      destination: sfxGain,
      time: time + index * 0.05,
      freq: midiToFreq(midi),
      endFreq: midiToFreq(midi + 0.15),
      peak: 0.035 - index * 0.004,
      attack: 0.004,
      release: 0.12,
      type: index === notes.length - 1 ? 'sawtooth' : 'triangle',
      lowpass: 3800,
    });
  });
}

export function playAttackSwingSound(animName) {
  if (animName === 'Roll') {
    playDodgeSound();
    return;
  }

  if (animName === 'Block_Loop') {
    const ctx = canPlayNow('swing');
    if (!ctx) return;
    const time = ctx.currentTime;
    createTone(ctx, {
      destination: sfxGain,
      time,
      freq: 240,
      endFreq: 160,
      peak: 0.02,
      attack: 0.002,
      release: 0.08,
      type: 'triangle',
      lowpass: 1800,
    });
    createNoiseSource(ctx, 1200, 0.01, time, 0.05, sfxGain, 1.1);
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

export function playDodgeSound() {
  const ctx = canPlayNow('dodge');
  if (!ctx) return;

  const time = ctx.currentTime;
  createTone(ctx, {
    destination: sfxGain,
    time,
    freq: 760,
    endFreq: 230,
    peak: 0.018,
    attack: 0.002,
    release: 0.11,
    type: 'triangle',
    lowpass: 2600,
  });
  createNoiseSource(ctx, 1500, 0.018, time, 0.085, sfxGain, 0.95);
}

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

export function playKoSound() {
  playBurst({
    peak: 0.12,
    baseFreq: 120,
    endFreq: 42,
    noiseFreq: 520,
    duration: 0.18,
    kind: 'ko',
    toneType: 'sawtooth',
    noisePeak: 0.1,
  });
}
