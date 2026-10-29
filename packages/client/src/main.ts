import { DEFAULT_BALANCE, FIXED_DT, sanitizeBalance, type BalanceParams, type Snapshot } from '@sfc/shared';
import { Simulation } from '@sfc/sim';
import { isMuted, playEffect, setMuted } from './audio.js';
import { buildInput, consumePress, installInput, pointer } from './input.js';
import { createCamera, drawFrame, interpolate, updateCamera, worldPoint, type View } from './render.js';

const canvas = document.querySelector<HTMLCanvasElement>('#view');
const bootError = document.querySelector<HTMLElement>('#boot-error');
if (!canvas) throw new Error('missing canvas');
const ctx = canvas.getContext('2d');
if (!ctx) {
  if (bootError) bootError.hidden = false;
  throw new Error('canvas 2d unavailable');
}

const sim = new Simulation({ seed: 1, ai: true });
const camera = createCamera();
let prev = sim.getSnapshot();
let curr = prev;
let acc = 0;
let last = performance.now();
let seq = 1;
let paused = false;
let debug = false;
let shake = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const heard = new Set<number>();
let fps = 60;
const view: View = { width: 1, height: 1 };

installInput(canvas);
resize();
window.addEventListener('resize', resize);

const api = {
  getSnapshot: () => sim.getSnapshot(),
  getProbe: (id: 'player' | 'dummy') => sim.getProbe(id),
  getStability: () => sim.getStability(),
  debugImpulse: (id: 'player' | 'dummy', ix: number, iy: number, ang = 0) => sim.debugImpulse(id, ix, iy, ang),
  debugShift: (id: 'player' | 'dummy', dx: number, dy: number) => sim.debugShift(id, dx, dy),
  setBalance: (partial: Partial<BalanceParams>) => {
    sim.setBalanceParams(partial);
    syncSliders();
  },
  reset: () => resetRound(),
};
window.__SFC__ = api;

function frame(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  fps += (1 / Math.max(dt, 0.001) - fps) * 0.08;
  if (consumePress('Escape')) togglePause();
  if (consumePress('F3')) debug = !debug;

  if (!paused) {
    acc += dt;
    let steps = 0;
    const aim = aimVector();
    while (acc >= FIXED_DT && steps < 5) {
      prev = curr;
      sim.step(FIXED_DT, buildInput(seq, aim));
      seq += 1;
      curr = sim.getSnapshot();
      acc -= FIXED_DT;
      steps += 1;
    }
    noteEffects(curr);
  }
  updateCamera(camera, curr, dt, view, shake);
  const alpha = paused ? 1 : acc / FIXED_DT;
  drawFrame(ctx!, interpolate(prev, curr, alpha), camera, view, debug, now);
  paintHud(curr);
  requestAnimationFrame(frame);
}

function aimVector(): { x: number; y: number } {
  const mouse = pointer();
  const torso = curr.fighters.find((fighter) => fighter.id === 'player')?.points.shoulder ?? { x: camera.x, y: camera.y };
  if (!mouse.ready) return { x: 1, y: 0.1 };
  const world = worldPoint(camera, view, mouse.x, mouse.y);
  return { x: world.x - torso.x, y: world.y - torso.y };
}

function noteEffects(snap: Snapshot): void {
  for (const effect of snap.effects) {
    if (heard.has(effect.id) || effect.kind === 'text') continue;
    heard.add(effect.id);
    playEffect(effect.kind, effect.mag);
  }
  if (heard.size > 80) {
    const keep = new Set(snap.effects.map((effect) => effect.id));
    for (const id of heard) if (!keep.has(id)) heard.delete(id);
  }
}

function paintHud(snap: Snapshot): void {
  const player = snap.fighters.find((fighter) => fighter.id === 'player');
  const dummy = snap.fighters.find((fighter) => fighter.id === 'dummy');
  setBar('player', player);
  setBar('dummy', dummy);
  const banner = document.querySelector<HTMLElement>('#banner');
  if (banner) {
    banner.hidden = !snap.banner;
    banner.textContent = snap.banner ?? '';
  }
  const stats = document.querySelector<HTMLElement>('#stats');
  const stability = sim.getStability();
  if (stats) {
    stats.textContent = `${Math.round(fps)} fps · ${stability.bodyCount} bodies · joint ${stability.maxJointSeparation.toFixed(3)} m`;
  }
}

function setBar(id: 'player' | 'dummy', fighter: Snapshot['fighters'][number] | undefined): void {
  const fill = document.querySelector<HTMLElement>(`#hp-${id}`);
  const num = document.querySelector<HTMLElement>(`#hp-${id}-n`);
  const state = document.querySelector<HTMLElement>(`#state-${id}`);
  if (!fighter || !fill || !num || !state) return;
  const pct = Math.max(0, Math.min(100, (fighter.hp / fighter.maxHp) * 100));
  fill.style.width = `${pct}%`;
  num.textContent = String(Math.round(fighter.hp));
  state.textContent = label(fighter.state, fighter.attack, fighter.blocking, fighter.grabbing);
}

function label(state: string, attack: string | null, blocking: boolean, grabbing: boolean): string {
  if (attack === 'punch') return 'Punch';
  if (attack === 'kick') return 'Kick';
  if (grabbing) return 'Grab';
  if (blocking) return 'Block';
  if (state === 'ko') return 'Down';
  if (state === 'getup') return 'Getting up';
  if (state === 'fallen') return 'Fallen';
  if (state === 'stumble') return 'Stumble';
  if (state === 'air') return 'Air';
  if (state === 'crouch') return 'Crouch';
  if (state === 'sprint') return 'Sprint';
  if (state === 'walk') return 'Walk';
  return 'Idle';
}

function resize(): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  view.width = window.innerWidth;
  view.height = window.innerHeight;
  canvas!.width = Math.floor(view.width * dpr);
  canvas!.height = Math.floor(view.height * dpr);
  ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function togglePause(): void {
  paused = !paused;
  const layer = document.querySelector<HTMLElement>('#pause-layer');
  const button = document.querySelector<HTMLButtonElement>('#pause-btn');
  if (layer) layer.hidden = !paused;
  if (button) button.textContent = paused ? 'Resume' : 'Pause';
}

function resetRound(): void {
  sim.reset();
  prev = sim.getSnapshot();
  curr = prev;
  acc = 0;
}

function bindHud(): void {
  document.querySelector('#pause-btn')?.addEventListener('click', togglePause);
  document.querySelector('#reset-btn')?.addEventListener('click', resetRound);
  const mute = document.querySelector<HTMLButtonElement>('#mute-btn');
  mute?.addEventListener('click', () => {
    setMuted(!isMuted());
    if (mute) {
      mute.textContent = isMuted() ? 'Sound off' : 'Sound on';
      mute.setAttribute('aria-pressed', String(isMuted()));
    }
  });
  const box = document.querySelector<HTMLElement>('#sliders');
  if (!box) return;
  const saved = loadTune();
  if (saved) sim.setBalanceParams(saved);
  for (const spec of TUNABLES) {
    const label = document.createElement('label');
    const name = document.createElement('span');
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(spec.min);
    input.max = String(spec.max);
    input.step = String(spec.step);
    input.dataset.key = spec.key;
    const value = sim.getBalanceParams()[spec.key];
    input.value = String(value);
    name.textContent = `${spec.label} ${formatNum(value)}`;
    input.addEventListener('input', () => {
      const next = Number(input.value);
      name.textContent = `${spec.label} ${formatNum(next)}`;
      sim.setBalanceParams({ [spec.key]: next });
      saveTune(sim.getBalanceParams());
    });
    label.append(name, input);
    box.append(label);
  }
  document.querySelector('#tune-reset')?.addEventListener('click', () => {
    localStorage.removeItem(TUNE_KEY);
    sim.setBalanceParams(DEFAULT_BALANCE);
    syncSliders();
  });
  const shakeBox = document.createElement('label');
  const shakeInput = document.createElement('input');
  shakeInput.type = 'checkbox';
  shakeInput.checked = shake;
  shakeInput.addEventListener('change', () => {
    shake = shakeInput.checked;
  });
  shakeBox.append(shakeInput, document.createTextNode(' Screen shake'));
  box.append(shakeBox);
}

function syncSliders(): void {
  const params = sim.getBalanceParams();
  for (const input of document.querySelectorAll<HTMLInputElement>('#sliders input[type=range]')) {
    const key = input.dataset.key as keyof BalanceParams | undefined;
    if (!key) continue;
    input.value = String(params[key]);
    const name = input.parentElement?.querySelector('span');
    const spec = TUNABLES.find((item) => item.key === key);
    if (name && spec) name.textContent = `${spec.label} ${formatNum(params[key])}`;
  }
}

function formatNum(value: number): string {
  return Math.abs(value) >= 10 ? value.toFixed(0) : value.toFixed(2);
}

const TUNE_KEY = 'sfc-balance-v1';

function loadTune(): Partial<BalanceParams> | null {
  try {
    const raw = localStorage.getItem(TUNE_KEY);
    if (!raw) return null;
    return sanitizeBalance({ ...DEFAULT_BALANCE, ...(JSON.parse(raw) as Partial<BalanceParams>) });
  } catch {
    return null;
  }
}

function saveTune(params: BalanceParams): void {
  try {
    localStorage.setItem(TUNE_KEY, JSON.stringify(params));
  } catch {
    // private mode
  }
}

const TUNABLES: { key: keyof BalanceParams; label: string; min: number; max: number; step: number }[] = [
  { key: 'uprightKp', label: 'Upright strength', min: 40, max: 700, step: 5 },
  { key: 'uprightKd', label: 'Upright damping', min: 0, max: 90, step: 1 },
  { key: 'maxBalanceForce', label: 'Balance force', min: 40, max: 500, step: 5 },
  { key: 'legTorque', label: 'Leg torque', min: 20, max: 250, step: 1 },
  { key: 'armTorque', label: 'Arm torque', min: 8, max: 120, step: 1 },
  { key: 'walkSpeed', label: 'Walk speed', min: 1, max: 8, step: 0.1 },
  { key: 'sprintSpeed', label: 'Sprint speed', min: 2, max: 12, step: 0.1 },
  { key: 'jumpSpeed', label: 'Jump speed', min: 4, max: 16, step: 0.1 },
  { key: 'stumbleAngle', label: 'Stumble angle', min: 0.3, max: 1.2, step: 0.01 },
  { key: 'fallAngle', label: 'Fall angle', min: 0.6, max: 2, step: 0.01 },
  { key: 'knockbackScale', label: 'Knockback', min: 0.2, max: 2.5, step: 0.05 },
  { key: 'gravity', label: 'Gravity', min: -50, max: -12, step: 0.5 },
];

bindHud();
requestAnimationFrame(frame);

declare global {
  interface Window {
    __SFC__: typeof api;
  }
}
