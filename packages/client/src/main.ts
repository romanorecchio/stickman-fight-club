import { DEFAULT_BALANCE, FIXED_DT, sanitizeBalance, type BalanceParams, type FighterSnapshot, type Snapshot } from '@sfc/shared';
import { Simulation } from '@sfc/sim';
import { isMuted, playEffect, setMuted } from './audio.js';
import { buildInput, consumePress, installInput, pointer } from './input.js';
import { OnlineSession } from './net.js';
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
let mode: 'gate' | 'training' | 'online' = 'gate';
let online: OnlineSession | null = null;
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
  if (consumePress('Escape')) togglePause();
  if (consumePress('F3')) debug = !debug;

  if (mode === 'training' && !paused) {
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
  } else if (mode === 'online' && online) {
    if (!paused) {
      online.sendInput(buildInput(seq, aimVector()));
      seq += 1;
    }
    const display = composeOnline();
    if (display) {
      prev = curr;
      curr = display;
      noteEffects(display);
    }
  }
  const focusId = mode === 'online' ? spectateFocus(curr) : 'player';
  updateCamera(camera, curr, dt, view, shake, focusId);
  const alpha = mode === 'online' || paused ? 1 : acc / FIXED_DT;
  drawFrame(ctx!, mode === 'online' ? curr : interpolate(prev, curr, alpha), camera, view, debug, now);
  paintHud(curr);
  requestAnimationFrame(frame);
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

function aimVector(): { x: number; y: number } {
  const mouse = pointer();
  const focus = mode === 'online' ? online?.localId : 'player';
  const torso = curr.fighters.find((fighter) => fighter.id === focus)?.points.shoulder ?? { x: camera.x, y: camera.y };
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
    stats.textContent = `${Math.round(fps)} fps${ping} · ${snap.fighters.length} fighters · joint ${stability.maxJointSeparation.toFixed(3)} m`;
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
bindGate();
requestAnimationFrame(frame);

function bindGate(): void {
  const params = new URLSearchParams(location.search);
  const codeInput = document.querySelector<HTMLInputElement>('#code');
  const nameInput = document.querySelector<HTMLInputElement>('#name');
  if (codeInput && params.get('room')) codeInput.value = params.get('room') ?? '';
  if (nameInput) nameInput.value = sessionStorage.getItem('sfc-name') ?? '';
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

function openOnline(kind: 'create' | 'join'): void {
  const name = document.querySelector<HTMLInputElement>('#name')?.value ?? '';
  const code = document.querySelector<HTMLInputElement>('#code')?.value ?? '';
  sessionStorage.setItem('sfc-name', name);
  ensureOnline();
  if (kind === 'create') online?.create(name);
  else online?.join(name, code);
}

function ensureOnline(): void {
  if (online) return;
  online = new OnlineSession({
    onWelcome: (welcome) => {
      sessionStorage.setItem('sfc-token', welcome.token);
      sessionStorage.setItem('sfc-code', welcome.code);
      mode = 'online';
      seq = 1;
      showMatch(welcome.code, welcome.hostId === welcome.playerId);
      renderLobby(welcome.lobby);
    },
    onLobby: (lobby) => renderLobby(lobby),
    onProblem: (problem) => showProblem(problem.message),
    onLeft: () => showGate(),
  });
}

function renderLobby(lobby: { code: string; hostId: string; settings?: { mode?: string; map?: string }; players: { id: string; name: string; host: boolean; connected: boolean; team?: string }[] }): void {
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
