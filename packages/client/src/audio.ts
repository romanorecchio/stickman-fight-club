// Procedural cartoon SFX. Everything is synthesized with Web Audio at runtime: no samples,
// no licensing. All sounds go through one master gain that follows the volume slider.
let ctx: AudioContext | null = null;
let out: GainNode | null = null;
let noiseBuf: AudioBuffer | null = null;
let muted = false;
let master = 0.7;
let voices = 0;
const MAX_VOICES = 14;

export function setVolume(next: number): void {
  master = Math.max(0, Math.min(1, next));
  if (out && ctx) out.gain.setTargetAtTime(master, ctx.currentTime, 0.02);
}

export function isMuted(): boolean {
  return muted;
}

export function setMuted(next: boolean): void {
  muted = next;
}

function context(): AudioContext | null {
  if (muted || master <= 0.001) return null;
  if (!ctx) {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return null;
    ctx = new Ctx();
    out = ctx.createGain();
    out.gain.value = master;
    const comp = ctx.createDynamicsCompressor();
    out.connect(comp);
    comp.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

function voice(seconds: number): { audio: AudioContext; t: number; dest: AudioNode } | null {
  const audio = context();
  if (!audio || !out || voices >= MAX_VOICES) return null;
  voices += 1;
  setTimeout(() => (voices -= 1), seconds * 1000 + 60);
  return { audio, t: audio.currentTime, dest: out };
}

function env(audio: AudioContext, t: number, peak: number, attack: number, decay: number): GainNode {
  const g = audio.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  return g;
}

function tone(type: OscillatorType, from: number, to: number, seconds: number, peak: number, delay = 0): void {
  const v = voice(seconds + delay);
  if (!v) return;
  const t = v.t + delay;
  const osc = v.audio.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(from, t);
  osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + seconds);
  const g = env(v.audio, t, peak, 0.005, seconds);
  osc.connect(g);
  g.connect(v.dest);
  osc.start(t);
  osc.stop(t + seconds + 0.05);
}

function noise(seconds: number, peak: number, filter: BiquadFilterType, freq: number, toFreq = freq, q = 1, delay = 0): void {
  const v = voice(seconds + delay);
  if (!v || !noiseBuf) return;
  const t = v.t + delay;
  const src = v.audio.createBufferSource();
  src.buffer = noiseBuf;
  src.playbackRate.value = 0.8 + Math.random() * 0.4;
  const f = v.audio.createBiquadFilter();
  f.type = filter;
  f.Q.value = q;
  f.frequency.setValueAtTime(freq, t);
  f.frequency.exponentialRampToValueAtTime(Math.max(30, toFreq), t + seconds);
  const g = env(v.audio, t, peak, 0.004, seconds);
  src.connect(f);
  f.connect(g);
  g.connect(v.dest);
  src.start(t, Math.random() * 0.5);
  src.stop(t + seconds + 0.05);
}

const jitter = (base: number, amount = 0.12) => base * (1 + (Math.random() * 2 - 1) * amount);

/** Cartoon spring: a pitch that shoots up and wobbles. */
export function boing(): void {
  const v = voice(0.45);
  if (!v) return;
  const { audio, t, dest } = v;
  const osc = audio.createOscillator();
  osc.type = 'sine';
  const base = jitter(180);
  osc.frequency.setValueAtTime(base, t);
  osc.frequency.exponentialRampToValueAtTime(base * 3.2, t + 0.12);
  osc.frequency.exponentialRampToValueAtTime(base * 2.1, t + 0.4);
  const lfo = audio.createOscillator();
  const depth = audio.createGain();
  lfo.frequency.value = 18;
  depth.gain.value = base * 0.35;
  lfo.connect(depth);
  depth.connect(osc.frequency);
  const g = env(audio, t, 0.22, 0.01, 0.38);
  osc.connect(g);
  g.connect(dest);
  osc.start(t);
  lfo.start(t);
  osc.stop(t + 0.45);
  lfo.stop(t + 0.45);
}

/** Hollow coconut knock for head hits. */
export function bonk(power = 1): void {
  const f = jitter(520);
  tone('sine', f, f * 0.6, 0.16, 0.35 * power);
  tone('triangle', f * 2.7, f * 1.4, 0.06, 0.12 * power);
  noise(0.03, 0.25 * power, 'bandpass', 2500, 1500, 2);
}

/** Wet cartoon slap. */
export function slap(power = 1): void {
  noise(0.09, 0.45 * power, 'highpass', 1800, 900, 0.7);
  tone('triangle', jitter(260), 90, 0.08, 0.2 * power);
}

/** Meaty body thump. */
export function thump(power = 1): void {
  tone('sine', jitter(140), 45, 0.18, 0.45 * power);
  noise(0.06, 0.18 * power, 'lowpass', 900, 200);
}

/** Swish of a big swing or a throw. */
export function whoosh(power = 1): void {
  noise(0.2, 0.12 * power, 'bandpass', 500, 2600, 2.5);
}

/** A little "oof"/"hup" vocal made from a buzzy saw through two formants. */
export function grunt(pitch = 1, length = 0.16): void {
  const v = voice(length + 0.05);
  if (!v) return;
  const { audio, t, dest } = v;
  const osc = audio.createOscillator();
  osc.type = 'sawtooth';
  const f0 = jitter(150 * pitch, 0.15);
  osc.frequency.setValueAtTime(f0 * 1.15, t);
  osc.frequency.exponentialRampToValueAtTime(f0 * 0.75, t + length);
  const g = env(audio, t, 0.2, 0.015, length);
  for (const [freq, q] of [
    [jitter(650), 6],
    [jitter(1100), 8],
  ] as const) {
    const f = audio.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = freq;
    f.Q.value = q;
    osc.connect(f);
    f.connect(g);
  }
  g.connect(dest);
  osc.start(t);
  osc.stop(t + length + 0.05);
}

/** KO: a descending slide whistle, then a tiny "ding ding" of birdies. */
export function koSound(): void {
  const v = voice(1.4);
  if (!v) return;
  const { audio, t, dest } = v;
  const osc = audio.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(1500, t);
  osc.frequency.exponentialRampToValueAtTime(180, t + 0.75);
  const lfo = audio.createOscillator();
  const depth = audio.createGain();
  lfo.frequency.value = 7;
  depth.gain.value = 25;
  lfo.connect(depth);
  depth.connect(osc.frequency);
  const g = env(audio, t, 0.2, 0.02, 0.75);
  osc.connect(g);
  g.connect(dest);
  osc.start(t);
  lfo.start(t);
  osc.stop(t + 0.85);
  lfo.stop(t + 0.85);
  tone('sine', 2093, 2000, 0.25, 0.08, 0.85);
  tone('sine', 2637, 2500, 0.3, 0.07, 1.0);
}

/** Thud of a body landing on the floor. */
export function flop(power = 1): void {
  tone('sine', jitter(90), 40, 0.2, 0.4 * power);
  noise(0.1, 0.15 * power, 'lowpass', 600, 150);
}

export function pop(): void {
  tone('sine', jitter(700), 1400, 0.05, 0.12);
}

/** Back-compat entry used for sim effects. */
export function playEffect(kind: string, mag: number): void {
  if (kind === 'hit') {
    if (Math.random() < 0.5) slap(Math.min(1.4, 0.6 + mag * 0.35));
    else thump(Math.min(1.4, 0.6 + mag * 0.35));
  } else if (kind === 'block') tone('triangle', 300, 200, 0.06, 0.12);
  else if (kind === 'throw') whoosh(1.4);
  else if (kind === 'boom') {
    tone('sine', 80, 30, 0.45, 0.6);
    noise(0.5, 0.4, 'lowpass', 1500, 100);
  }
}

/** Kept for any caller of the old API. */
export function thud(freq: number, seconds: number, gain: number): void {
  tone('triangle', freq, Math.max(40, freq * 0.35), seconds, gain * 3);
}
