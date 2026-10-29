let ctx: AudioContext | null = null;
let muted = false;

export function isMuted(): boolean {
  return muted;
}

export function setMuted(next: boolean): void {
  muted = next;
}

function context(): AudioContext | null {
  if (muted) return null;
  if (!ctx) {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return null;
    ctx = new Ctx();
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

export function thud(freq: number, seconds: number, gain: number): void {
  const audio = context();
  if (!audio) return;
  const t = audio.currentTime;
  const osc = audio.createOscillator();
  const amp = audio.createGain();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(freq, t);
  osc.frequency.exponentialRampToValueAtTime(Math.max(40, freq * 0.35), t + seconds);
  amp.gain.setValueAtTime(gain, t);
  amp.gain.exponentialRampToValueAtTime(0.0001, t + seconds);
  osc.connect(amp);
  amp.connect(audio.destination);
  osc.start(t);
  osc.stop(t + seconds + 0.02);
}

export function playEffect(kind: string, mag: number): void {
  if (kind === 'hit') thud(140 + mag * 40, 0.09, 0.08);
  else if (kind === 'block') thud(90, 0.06, 0.04);
  else if (kind === 'throw') thud(70, 0.14, 0.07);
  else if (kind === 'boom') thud(55 + mag * 8, 0.22, 0.12);
}
