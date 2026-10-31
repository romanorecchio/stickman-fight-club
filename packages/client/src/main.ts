import { DEFAULT_BALANCE, FIXED_DT, sanitizeBalance, type BalanceParams, type FighterSnapshot, type Snapshot } from '@sfc/shared';
import { Simulation } from '@sfc/sim';
import { isMuted, setMuted, setVolume } from './audio.js';
import { frozen, observe, tick as tickJuice } from './juice.js';
import { buildInput, consumePress, heading, installInput } from './input.js';
import { OnlineSession, type Look } from './net.js';
import { createCamera, drawFrame, interpolate, updateCamera, type View } from './render.js';

const canvas = document.querySelector<HTMLCanvasElement>('#view');
const bootError = document.querySelector<HTMLElement>('#boot-error');
if (!canvas) throw new Error('missing canvas');
const ctx = canvas.getContext('2d');
if (!ctx) {
  if (bootError) bootError.hidden = false;
  throw new Error('canvas 2d unavailable');
}

// Declared before any top-level call: bindGate() reads these, and a `const` used before its line throws (TDZ).
const NAME_KEY = 'sfc-name';
const LOOK_KEY = 'sfc-look';
const NAME_A = ['Swift', 'Wobbly', 'Mighty', 'Sneaky', 'Spicy', 'Rowdy', 'Tiny', 'Lucky', 'Cranky', 'Bouncy'];
const NAME_B = ['Stick', 'Noodle', 'Brawler', 'Kicker', 'Puncher', 'Ninja', 'Goblin', 'Twig', 'Bruiser', 'Pogo'];

const sim = new Simulation({ seed: 1, ai: true });
const camera = createCamera();
let mode: 'gate' | 'training' | 'online' = 'gate';
let online: OnlineSession | null = null;
let prev = sim.getSnapshot();
let curr = prev;
let acc = 0;
let netAcc = 0;
let last = performance.now();
let seq = 1;
let paused = false;
let debug = false;
let replay: Snapshot[] | null = null;
let replayIndex = 0;
let replayAcc = 0;
let reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
let reduceFlash = false;
let shake = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
let fps = 60;
const view: View = { width: 1, height: 1 };

installInput(canvas);
resize();
window.addEventListener('resize', resize);

const api = {
  getSnapshot: () => (mode === 'online' ? (online?.latest() ?? curr) : sim.getSnapshot()),
  getProbe: (id: 'player' | 'dummy') => sim.getProbe(id),
  getStability: () => sim.getStability(),
  getMode: () => mode,
  getNet: () => ({
    lobby: online?.lobby ?? null,
    latest: online?.latest() ?? null,
    localId: online?.localId ?? '',
    rtt: online?.rtt ?? 0,
  }),
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
  if (consumePress('Escape')) {
    if (replay) replay = null;
    else togglePause();
  }
  if (consumePress('F3')) debug = !debug;

  const freeze = frozen(now) && !reduceMotion;
  if (mode === 'training' && !paused) {
    // Hit-stop: the world holds its breath for a few frames on a big hit.
    if (!freeze) acc += dt;
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
    observe(curr, now, 'player');
  } else if (mode === 'online' && online) {
    // Inputs go out at the sim's fixed 60 Hz, not once per display frame: on a 120/144 Hz
    // screen the old per-frame send ran local prediction 2x fast and tripped the rate limit.
    netAcc = Math.min(netAcc + dt, FIXED_DT * 5);
    while (!paused && netAcc >= FIXED_DT) {
      online.sendInput(buildInput(seq, aimVector()));
      seq += 1;
      netAcc -= FIXED_DT;
    }
    const display = freeze ? null : composeOnline();
    if (display) {
      prev = curr;
      curr = display;
      observe(display, now, online.localId);
    }
  }
  const shown = replayFrame(dt) ?? curr;
  if (reduceFlash) for (const fighter of shown.fighters) fighter.flash = 0;
  const focusId = mode === 'online' ? spectateFocus(shown) : 'player';
  tickJuice(shown, freeze ? dt * 0.15 : dt);
  updateCamera(camera, shown, dt, view, shake && !reduceMotion, focusId);
  const alpha = mode === 'online' || paused || replay ? 1 : acc / FIXED_DT;
  drawFrame(ctx!, mode === 'online' || replay ? shown : interpolate(prev, curr, alpha), camera, view, debug, now);
  const fx = (shown as Snapshot & { fx?: import('@sfc/shared').PrivateFx | null }).fx;
  if (canvas) canvas.style.transform = fx?.flipScreen ? 'scaleY(-1)' : fx?.mirror ? 'scaleX(-1)' : '';
  paintScare(fx);
  paintHud(curr);
  requestAnimationFrame(frame);
}

let scareMod: typeof import('./scare.js') | null = null;

function paintScare(fx: import('@sfc/shared').PrivateFx | null | undefined): void {
  if (fx?.jumpscare) {
    const dismiss = () => online?.emit('dismiss-scare');
    if (scareMod) scareMod.showScare(fx, dismiss);
    else void import('./scare.js').then((mod) => {
      scareMod = mod;
      mod.showScare(fx, dismiss);
    });
  } else scareMod?.hideScare();
}

function replayFrame(dt: number): Snapshot | null {
  if (!replay || replay.length === 0) return null;
  replayAcc += dt;
  const step = reduceMotion ? 0.08 : 0.1;
  while (replayAcc > step && replayIndex < replay.length - 1) {
    replayAcc -= step;
    replayIndex += 1;
  }
  const skip = document.querySelector<HTMLElement>('#skip-replay');
  if (skip) skip.hidden = false;
  if (replayIndex >= replay.length - 1 && replayAcc > 0.4) {
    replay = null;
    if (skip) skip.hidden = true;
    return null;
  }
  return replay[replayIndex] ?? null;
}

function composeOnline(): Snapshot | null {
  if (!online) return null;
  const sample = online.sample(performance.now());
  if (!sample) return null;
  const merged = interpolate(sample.older, sample.newer, sample.alpha);
  const predicted = online.predicted();
  const serverMine = sample.newer.fighters.find((fighter) => fighter.id === online?.localId);
  if (predicted && serverMine) {
    merged.fighters = merged.fighters.map((fighter) =>
      fighter.id === serverMine.id ? blendLocal(predicted, serverMine) : fighter,
    );
    merged.banner = bannerFor(serverMine);
  }
  return merged;
}

function blendLocal(predicted: FighterSnapshot, server: FighterSnapshot): FighterSnapshot {
  return {
    ...predicted,
    hp: server.hp,
    maxHp: server.maxHp,
    state: server.state,
    name: server.name,
    color: server.color,
    flash: Math.max(predicted.flash, server.flash),
    protecting: server.protecting,
    weapon: server.weapon,
    ammo: server.ammo,
    reserve: server.reserve,
    infected: server.infected,
    hat: server.hat,
    face: server.face,
    invisible: server.invisible,
    scale: server.scale,
    giantHead: server.giantHead,
  };
}

let spectateCursor = 0;

function spectateFocus(snap: Snapshot): string {
  const me = snap.match?.rows.find((row) => row.id === online?.localId);
  const hint = document.querySelector<HTMLElement>('#spectate-hint');
  if (hint) hint.hidden = !me?.spectating;
  if (!me?.spectating) return online?.localId || 'player';
  if (consumePress('KeyC')) spectateCursor += 1;
  const targets = snap.match?.rows.filter((row) => !row.spectating) ?? [];
  const pick = targets[spectateCursor % Math.max(1, targets.length)];
  return pick?.id ?? online?.localId ?? 'player';
}

function bannerFor(fighter: FighterSnapshot): string | null {
  if (fighter.state === 'ko') return "YOU'RE DOWN";
  if (fighter.state === 'fallen') return 'GET UP';
  if (fighter.state === 'getup') return 'GETTING UP';
  return null;
}

let aimDir = 1;

/**
 * No mouse aiming: punches and grabs home in on the nearest stickman in the direction
 * you're heading. Holding someone aims the throw up and forward.
 */
function aimVector(): { x: number; y: number } {
  const focus = mode === 'online' ? online?.localId : 'player';
  const me = curr.fighters.find((fighter) => fighter.id === focus);
  const push = heading();
  if (push !== 0) aimDir = push;
  else if (me && !me.grabbing) aimDir = me.facing;
  if (!me) return { x: aimDir, y: 0.1 };
  if (me.grabbing) return { x: aimDir, y: 0.75 };
  const from = me.points.shoulder;
  let best: { x: number; y: number; d: number } | null = null;
  for (const other of curr.fighters) {
    if (other.id === me.id || other.invisible || other.state === 'ko') continue;
    const at = other.points.shoulder;
    const dx = at.x - from.x;
    const dy = at.y - from.y;
    const d = Math.hypot(dx, dy);
    const ahead = Math.sign(dx) === aimDir;
    if (d > 3.2 || Math.abs(dy) > 2.2) continue;
    if (!ahead && (push !== 0 || d > 1.4)) continue;
    if (!best || d < best.d) best = { x: dx, y: dy, d };
  }
  if (best) {
    if (push === 0) aimDir = Math.sign(best.x) || aimDir;
    return { x: best.x, y: best.y - 0.05 };
  }
  return { x: aimDir, y: 0.1 };
}

function paintHud(snap: Snapshot): void {
  const roster = document.querySelector<HTMLElement>('#roster');
  if (roster) {
    const focus = mode === 'online' ? online?.localId : 'player';
    roster.replaceChildren(
      ...snap.fighters.map((fighter) => {
        const bar = document.createElement('div');
        bar.className = `bar ${fighter.id === focus ? 'you' : 'them'}`;
        const pct = Math.max(0, Math.min(100, (fighter.hp / fighter.maxHp) * 100));
        bar.innerHTML = `<div class="bar-top"><span></span><em></em><b></b></div><div class="track"><div class="fill"></div></div>`;
        const name = bar.querySelector('span');
        const state = bar.querySelector('em');
        const num = bar.querySelector('b');
        const fill = bar.querySelector<HTMLElement>('.fill');
        if (name) name.textContent = fighter.name;
        if (state) state.textContent = weaponLabel(fighter) || label(fighter.state, fighter.attack, fighter.blocking, fighter.grabbing);
        if (num) num.textContent = String(Math.round(fighter.hp));
        if (fill) fill.style.width = `${pct}%`;
        return bar;
      }),
    );
  }
  const banner = document.querySelector<HTMLElement>('#banner');
  if (banner) {
    banner.hidden = !snap.banner;
    banner.textContent = snap.banner ?? '';
  }
    const card = document.querySelector<HTMLElement>('#lobby-card');
  const matchPhase = snap.match?.phase;
  if (card && matchPhase) card.hidden = matchPhase === 'countdown' || matchPhase === 'fight' || matchPhase === 'roundEnd';
  const board = document.querySelector<HTMLElement>('#scoreboard');
  if (board) {
    const match = snap.match;
    if (!match || match.phase === 'lobby') board.hidden = true;
    else {
      board.hidden = false;
      const lines = match.rows
        .map((row) => `${row.name}${row.team !== 'none' ? ` ${row.team}` : ''}  ${row.kills}K ${row.deaths}D  ${Math.floor(row.score)}`)
        .join('\n');
      board.textContent = `${match.banner ?? match.mode.toUpperCase()}  ${Math.ceil(match.timeLeft)}s\n${lines}`;
    }
  }
  const stats = document.querySelector<HTMLElement>('#stats');
  const stability = sim.getStability();
  if (stats) {
    const ping = mode === 'online' && online ? ` · ${Math.round(online.rtt)} ms` : '';
    const dev = debug ? ` · tick ${snap.tick} · bodies ${snap.solids.length + snap.fighters.length * 14}` : '';
    stats.textContent = `${Math.round(fps)} fps${ping} · ${snap.fighters.length} fighters${dev} · joint ${stability.maxJointSeparation.toFixed(3)} m`;
  }
}

function weaponLabel(fighter: { weapon: string | null; ammo: number; reserve: number }): string {
  if (!fighter.weapon) return '';
  const name = fighter.weapon;
  if (fighter.ammo <= 0 && fighter.reserve <= 0) return name;
  return `${name} ${fighter.ammo}/${fighter.reserve}`;
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
  document.querySelector('#skip-replay')?.addEventListener('click', () => {
    replay = null;
    const skip = document.querySelector<HTMLElement>('#skip-replay');
    if (skip) skip.hidden = true;
  });
  const volume = document.querySelector<HTMLInputElement>('#volume');
  const motion = document.querySelector<HTMLInputElement>('#reduce-motion');
  const flash = document.querySelector<HTMLInputElement>('#reduce-flash');
  const scare = document.querySelector<HTMLInputElement>('#no-jumpscares');
  const shakeToggle = document.querySelector<HTMLInputElement>('#shake-toggle');
  try {
    const saved = JSON.parse(localStorage.getItem('sfc-settings') ?? '{}') as {
      volume?: number;
      shake?: boolean;
      reduceMotion?: boolean;
      reduceFlash?: boolean;
      jumpscares?: boolean;
    };
    if (typeof saved.volume === 'number' && volume) volume.value = String(saved.volume);
    if (typeof saved.shake === 'boolean') {
      shake = saved.shake;
      if (shakeToggle) shakeToggle.checked = saved.shake;
    }
    if (saved.reduceMotion) reduceMotion = true;
    if (saved.reduceFlash) reduceFlash = true;
  } catch {
    // ignore broken settings
  }
  const pushPrefs = () => {
    reduceMotion = motion?.checked === true || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    reduceFlash = flash?.checked === true;
    shake = shakeToggle?.checked !== false && !reduceMotion;
    setVolume(Number(volume?.value ?? 70) / 100);
    const prefs = {
      jumpscares: scare?.checked !== true,
      reduceMotion,
      reduceFlash,
    };
    localStorage.setItem('sfc-settings', JSON.stringify({ volume: Number(volume?.value ?? 70), shake, ...prefs }));
    online?.emit('prefs', prefs);
  };
  setVolume(Number(volume?.value ?? 70) / 100);
  if (motion) motion.checked = reduceMotion;
  if (flash) flash.checked = reduceFlash;
  if (shakeToggle) shakeToggle.checked = shake;
  for (const input of [volume, motion, flash, scare, shakeToggle]) {
    input?.addEventListener('input', pushPrefs);
    input?.addEventListener('change', pushPrefs);
  }
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

const TUNE_KEY = 'sfc-balance-v2';

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


function bindGate(): void {
  const params = new URLSearchParams(location.search);
  const codeInput = document.querySelector<HTMLInputElement>('#code');
  const nameInput = document.querySelector<HTMLInputElement>('#name');
  if (codeInput && params.get('room')) codeInput.value = params.get('room') ?? '';
  if (nameInput) {
    nameInput.value = savedName();
    nameInput.addEventListener('change', () => {
      const next = nameInput.value.trim().slice(0, 16);
      if (next) localStorage.setItem(NAME_KEY, next);
    });
  }
  const look = savedLook();
  const color = document.querySelector<HTMLInputElement>('#color-select');
  const hat = document.querySelector<HTMLSelectElement>('#hat-select');
  const face = document.querySelector<HTMLSelectElement>('#face-select');
  if (color) color.value = String(look.color);
  if (hat) hat.value = look.hat;
  if (face) face.value = look.face;
  for (const input of [color, hat, face]) input?.addEventListener('change', () => localStorage.setItem(LOOK_KEY, JSON.stringify(readLook())));
  document.querySelector('#train-btn')?.addEventListener('click', () => {
    const dummyOn = document.querySelector<HTMLInputElement>('#dummy-toggle')?.checked ?? true;
    sim.setDummyEnabled(dummyOn);
    enterTraining();
  });
  document.querySelector('#create-btn')?.addEventListener('click', () => openOnline('create'));
  document.querySelector('#join-btn')?.addEventListener('click', () => openOnline('join'));
  document.querySelector('#leave-btn')?.addEventListener('click', () => {
    sessionStorage.removeItem('sfc-token');
    online?.leave();
    showGate();
  });
  document.querySelector('#start-match')?.addEventListener('click', () => {
    online?.emit('settings', readSettings());
    online?.emit('start-match');
  });
  document.querySelector('#mode-select')?.addEventListener('change', () => online?.emit('settings', readSettings()));
  document.querySelector('#host-settings')?.addEventListener('change', () => online?.emit('settings', readSettings()));
  document.querySelector('#team-red')?.addEventListener('click', () => online?.emit('team', { team: 'red' }));
  document.querySelector('#team-blue')?.addEventListener('click', () => online?.emit('team', { team: 'blue' }));
  document.querySelector('#copy-btn')?.addEventListener('click', async () => {
    const url = document.querySelector('#join-url')?.textContent ?? '';
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // clipboard can be blocked; the URL is still on screen
    }
  });
  const saved = sessionStorage.getItem('sfc-token');
  if (saved) {
    ensureOnline();
    setPending('reconnect');
    online?.reconnect(saved);
  }
}

function readSettings(): Record<string, unknown> {
  return {
    mode: (document.querySelector<HTMLSelectElement>('#mode-select')?.value ?? 'ffa'),
    roundSeconds: Number(document.querySelector<HTMLInputElement>('#round-seconds')?.value ?? 90),
    scoreLimit: Number(document.querySelector<HTMLInputElement>('#score-limit')?.value ?? 10),
    elimination: document.querySelector<HTMLInputElement>('#elimination')?.checked ?? false,
    friendlyFire: document.querySelector<HTMLInputElement>('#friendly-fire')?.checked ?? true,
    rounds: Number(document.querySelector<HTMLInputElement>('#rounds')?.value ?? 1),
    startingHp: Number(document.querySelector<HTMLInputElement>('#starting-hp')?.value ?? 100),
    bestOf: Number(document.querySelector<HTMLSelectElement>('#best-of')?.value ?? 3),
    hillSeconds: Number(document.querySelector<HTMLInputElement>('#hill-seconds')?.value ?? 8),
    hillMoves: document.querySelector<HTMLInputElement>('#hill-moves')?.checked ?? false,
    lateJoin: document.querySelector<HTMLSelectElement>('#late-join')?.value ?? 'spectate',
    chaosBanner: document.querySelector<HTMLInputElement>('#chaos-banner')?.checked ?? false,
    map: document.querySelector<HTMLSelectElement>('#map-select')?.value ?? 'classic',
    weapons: document.querySelector<HTMLInputElement>('#weapons-on')?.checked ?? true,
    categories: {
      melee: document.querySelector<HTMLInputElement>('#cat-melee')?.checked ?? true,
      firearm: document.querySelector<HTMLInputElement>('#cat-firearm')?.checked ?? true,
      explosive: document.querySelector<HTMLInputElement>('#cat-explosive')?.checked ?? true,
      novelty: document.querySelector<HTMLInputElement>('#cat-novelty')?.checked ?? true,
    },
  };
}

/** Set while a create/join is in flight so repeat clicks don't fire twice. */
let pending: 'create' | 'join' | 'reconnect' | null = null;
let pendingTimer: ReturnType<typeof setTimeout> | null = null;

function openOnline(kind: 'create' | 'join'): void {
  if (pending === 'create' || pending === 'join') return;
  const nameInput = document.querySelector<HTMLInputElement>('#name');
  let name = (nameInput?.value ?? '').trim().slice(0, 16);
  if (!name) {
    name = randomName();
    if (nameInput) nameInput.value = name;
  }
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    // storage blocked; the name still goes to the server
  }
  const code = (document.querySelector<HTMLInputElement>('#code')?.value ?? '').trim().toUpperCase();
  if (kind === 'join' && !code) {
    showProblem('Enter a room code to join.');
    return;
  }
  const look = readLook();
  try {
    localStorage.setItem(LOOK_KEY, JSON.stringify(look));
  } catch {
    // storage blocked
  }
  hideProblem();
  ensureOnline();
  setPending(kind);
  // socket.io buffers emits until the socket connects, so a click while the Fly machine wakes is queued, not dropped.
  if (kind === 'create') online?.create(name, look);
  else online?.join(name, code, look);
}

function setPending(kind: typeof pending): void {
  pending = kind;
  if (pendingTimer) clearTimeout(pendingTimer);
  pendingTimer = null;
  for (const id of ['#create-btn', '#join-btn']) {
    const button = document.querySelector<HTMLButtonElement>(id);
    if (button) button.disabled = kind === 'create' || kind === 'join';
  }
  if (!kind) {
    setStatus(null);
    return;
  }
  const verb = kind === 'create' ? 'Creating lobby…' : kind === 'join' ? 'Joining lobby…' : 'Rejoining your lobby…';
  setStatus(online?.connected ? verb : 'Connecting…');
  pendingTimer = setTimeout(() => {
    if (pending) setStatus("Couldn't connect, retrying…");
  }, 10000);
}

function setStatus(text: string | null): void {
  const status = document.querySelector<HTMLElement>('#gate-status');
  if (!status) return;
  status.hidden = !text;
  status.textContent = text ?? '';
}

function hideProblem(): void {
  const problem = document.querySelector<HTMLElement>('#gate-error');
  if (problem) problem.hidden = true;
}

function ensureOnline(): void {
  if (online) return;
  online = new OnlineSession({
    onWelcome: (welcome) => {
      setPending(null);
      sessionStorage.setItem('sfc-token', welcome.token);
      sessionStorage.setItem('sfc-code', welcome.code);
      mode = 'online';
      seq = 1;
      showMatch(welcome.code, welcome.hostId === welcome.playerId);
      renderLobby(welcome.lobby);
    },
    onLobby: (lobby) => renderLobby(lobby),
    onProblem: (problem) => {
      if (pending === 'reconnect') {
        // A stale token from an old tab or a restarted server: forget it quietly.
        setPending(null);
        sessionStorage.removeItem('sfc-token');
        if (problem.code === 'token' || problem.code === 'closed') return;
      }
      if (pending) setPending(null);
      if (problem.code === 'rate') return;
      showProblem(problem.code === 'not_found' && problem.message.includes('No lobby') ? 'Room not found. Check the code and try again.' : problem.message);
    },
    onStatus: (status) => {
      if (!pending) {
        if (status === 'retrying' && mode === 'online') setStatus("Connection lost, reconnecting…");
        else if (status === 'connected') setStatus(null);
        return;
      }
      if (status === 'connected') setStatus(pending === 'create' ? 'Creating lobby…' : pending === 'join' ? 'Joining lobby…' : 'Rejoining your lobby…');
      else if (status === 'retrying') setStatus("Couldn't connect, retrying…");
      else setStatus('Connecting…');
    },
    onLeft: () => showGate(),
    onReplay: (frames) => {
      if (frames.length < 2) return;
      replay = frames;
      replayIndex = 0;
      replayAcc = 0;
    },
    onGate: (payload) => {
      void import('./owner-panel.js').then((mod) => {
        if (online) mod.openPanel(online, payload.effects);
      });
    },
  });
}

// Chaos Control: press O twice quickly (within 400 ms) to toggle the panel. No lock, open to every player.
let lastO = 0;
let chaosRequested = false;
window.addEventListener('keydown', (event) => {
  if (event.code !== 'KeyO' || event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
  const target = event.target as HTMLElement | null;
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || target?.isContentEditable) return;
  const now = performance.now();
  if (now - lastO > 400) {
    lastO = now;
    return;
  }
  lastO = 0;
  ensureOnline();
  if (!chaosRequested) {
    chaosRequested = true;
    online?.emit('chaos-open');
    return;
  }
  void import('./owner-panel.js').then((mod) => {
    if (!mod.togglePanel()) online?.emit('chaos-open');
  });
});


function randomName(): string {
  const pick = (list: string[]) => list[Math.floor(Math.random() * list.length)] ?? list[0]!;
  return `${pick(NAME_A)}${pick(NAME_B)}${Math.floor(Math.random() * 90) + 10}`.slice(0, 16);
}

/** Display name for this browser: the last one used, or a fresh random one saved right away. */
function savedName(): string {
  const stored = (localStorage.getItem(NAME_KEY) ?? '').trim();
  if (stored) return stored.slice(0, 16);
  const fresh = randomName();
  localStorage.setItem(NAME_KEY, fresh);
  return fresh;
}

function savedLook(): Look {
  try {
    const raw = JSON.parse(localStorage.getItem(LOOK_KEY) ?? '{}') as Partial<Look>;
    return {
      color: Number.isFinite(Number(raw.color)) ? Math.max(0, Math.min(7, Math.round(Number(raw.color)))) : 0,
      hat: typeof raw.hat === 'string' ? raw.hat : 'none',
      face: typeof raw.face === 'string' ? raw.face : 'dot',
    };
  } catch {
    return { color: 0, hat: 'none', face: 'dot' };
  }
}

function readLook(): Look {
  const color = Number(document.querySelector<HTMLInputElement>('#color-select')?.value ?? 0);
  return {
    color: Number.isFinite(color) ? Math.max(0, Math.min(7, Math.round(color))) : 0,
    hat: document.querySelector<HTMLSelectElement>('#hat-select')?.value ?? 'none',
    face: document.querySelector<HTMLSelectElement>('#face-select')?.value ?? 'dot',
  };
}

function renderLobby(lobby: { code: string; hostId: string; chaosBanner?: boolean; settings?: { mode?: string; map?: string }; players: { id: string; name: string; host: boolean; connected: boolean; team?: string }[] }): void {
  const code = document.querySelector('#room-code');
  const url = document.querySelector('#join-url');
  const list = document.querySelector('#lobby-list');
  const host = document.querySelector('#host-tag');
  if (code) code.textContent = lobby.code;
  if (url) url.textContent = `${location.origin}${location.pathname}?room=${lobby.code}`;
  if (host) host.textContent = lobby.hostId === online?.localId ? 'HOST' : '';
  const settings = document.querySelector<HTMLElement>('#host-settings');
  if (settings) settings.hidden = lobby.hostId !== online?.localId;
  if (list) {
    list.replaceChildren(
      ...lobby.players.map((player) => {
        const item = document.createElement('li');
        const team = player.team && player.team !== 'none' ? ` · ${player.team}` : '';
        item.textContent = `${player.name}${team}${player.host ? ' · host' : ''}${player.connected ? '' : ' · reconnecting'}`;
        if (lobby.chaosBanner && player.host) item.textContent += ' · CHAOS MODE';
        return item;
      }),
    );
  }
}

function enterTraining(): void {
  mode = 'training';
  document.querySelector<HTMLElement>('#gate')!.hidden = true;
  document.querySelector<HTMLElement>('#lobby-card')!.hidden = true;
  document.querySelector<HTMLElement>('#leave-btn')!.hidden = true;
  document.querySelector<HTMLElement>('#reset-btn')!.hidden = false;
  document.querySelector<HTMLElement>('#tune')!.hidden = false;
  const eyebrow = document.querySelector('#eyebrow');
  if (eyebrow) eyebrow.textContent = 'Training room';
  prev = sim.getSnapshot();
  curr = prev;
}

function showMatch(code: string, host: boolean): void {
  document.querySelector<HTMLElement>('#gate')!.hidden = true;
  document.querySelector<HTMLElement>('#lobby-card')!.hidden = false;
  document.querySelector<HTMLElement>('#leave-btn')!.hidden = false;
  document.querySelector<HTMLElement>('#reset-btn')!.hidden = true;
  document.querySelector<HTMLElement>('#tune')!.hidden = true;
  const eyebrow = document.querySelector('#eyebrow');
  if (eyebrow) eyebrow.textContent = host ? `Lobby ${code} · host` : `Lobby ${code}`;
  const problem = document.querySelector<HTMLElement>('#gate-error');
  if (problem) problem.hidden = true;
}

function showGate(): void {
  mode = 'gate';
  document.querySelector<HTMLElement>('#gate')!.hidden = false;
  document.querySelector<HTMLElement>('#lobby-card')!.hidden = true;
  document.querySelector<HTMLElement>('#leave-btn')!.hidden = true;
  document.querySelector<HTMLElement>('#reset-btn')!.hidden = false;
  document.querySelector<HTMLElement>('#tune')!.hidden = false;
}

function showProblem(message: string): void {
  const problem = document.querySelector<HTMLElement>('#gate-error');
  if (!problem) return;
  problem.hidden = false;
  problem.textContent = message;
  document.querySelector<HTMLElement>('#gate')!.hidden = false;
}

declare global {
  interface Window {
    __SFC__: typeof api;
  }
}

// Boot last, after every top-level const/let above is initialized.
try {
  bindHud();
  bindGate();
} catch (error) {
  console.error('sfc boot failed', error);
  if (bootError) {
    bootError.textContent = 'Something broke while loading. Reload the page to try again.';
    bootError.hidden = false;
  }
}
requestAnimationFrame(frame);
