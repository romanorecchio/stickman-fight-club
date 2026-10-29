import { io as ioClient, type Socket } from 'socket.io-client';
import { afterEach, describe, expect, it } from 'vitest';
import { sanitizeUsername } from '@sfc/shared';
import { emptyInput } from '@sfc/shared';
import { MatchDirectory } from './rooms.js';
import { startServer, type RunningServer } from './server.js';

const servers: RunningServer[] = [];

afterEach(async () => {
  while (servers.length) {
    const server = servers.pop();
    if (server) await server.close();
  }
});

describe('lobby rules', () => {
  it('sanitizes names and rejects junk codes', () => {
    expect(sanitizeUsername('  <b>Ada</b>  ')).toBe('bAda/b');
    expect(sanitizeUsername('   ')).toBeNull();
    const directory = new MatchDirectory();
    const bad = directory.join('nope', 'Ada', 1_000);
    expect('message' in bad).toBe(true);
    const missing = directory.join('ZZZZZZ', 'Ada', 1_000);
    expect(missing).toMatchObject({ code: 'not_found' });
  });

  it('lets guests pick any look with just a name, and ignores a bad look', () => {
    const directory = new MatchDirectory();
    const host = directory.create('Ada', { color: 6, hat: 'halo', face: 'shades' }, 1_000);
    if (!('welcome' in host)) throw new Error('create');
    expect(host.welcome.lobby.players[0]).toMatchObject({ name: 'Ada', color: 6 });
    const guest = directory.join(host.welcome.code, 'Bea', { color: 99, hat: 'jetpack' }, 1_000);
    if (!('welcome' in guest)) throw new Error('join');
    expect(guest.welcome.lobby.players.map((p) => p.name)).toEqual(['Ada', 'Bea']);
  });

  it('caps a room at 8, isolates a second room, and keeps spawns apart', () => {
    const directory = new MatchDirectory();
    const now = 5_000;
    const first = directory.create('Host', now);
    if (!('welcome' in first)) throw new Error('create failed');
    for (let i = 0; i < 7; i += 1) {
      const joined = directory.join(first.welcome.code, `Fighter ${i}`, now);
      expect('welcome' in joined).toBe(true);
    }
    const ninth = directory.join(first.welcome.code, 'Extra', now);
    expect(ninth).toMatchObject({ code: 'full' });

    const other = directory.create('Other', now);
    if (!('welcome' in other)) throw new Error('second create failed');
    expect(other.welcome.code).not.toBe(first.welcome.code);
    expect(directory.lobby(other.welcome.code)?.players).toHaveLength(1);
    expect(directory.lobby(first.welcome.code)?.players).toHaveLength(8);

    const snaps = [];
    for (let i = 0; i < 6; i += 1) snaps.push(...directory.pump(now + (i + 1) * 20));
    const snap = snaps.find((item) => item.fighters.length === 8 && item.you === first.welcome.playerId);
    expect(snap).toBeTruthy();
    const xs = snap?.fighters.map((fighter) => fighter.points.hip.x) ?? [];
    for (let i = 0; i < xs.length; i += 1) {
      for (let j = i + 1; j < xs.length; j += 1) {
        expect(Math.abs((xs[i] ?? 0) - (xs[j] ?? 0))).toBeGreaterThan(1);
      }
    }
    const otherSnap = snaps.find((item) => item.you === other.welcome.playerId);
    expect(otherSnap?.fighters.map((fighter) => fighter.id)).toEqual([other.welcome.playerId]);
  });

  it('migrates the host and accepts a reconnect token inside the grace window', () => {
    const directory = new MatchDirectory({ graceMs: 300 });
    const host = directory.create('Ada', 10_000);
    if (!('welcome' in host)) throw new Error('host');
    const guest = directory.join(host.welcome.code, 'Bea', 10_000);
    if (!('welcome' in guest)) throw new Error('guest');
    directory.disconnect(host.welcome.token, 10_000);
    expect(directory.lobby(host.welcome.code)?.hostId).toBe(guest.playerId);
    const back = directory.reconnect(host.welcome.token, 10_100);
    expect(back).toMatchObject({ playerId: host.playerId });
    directory.disconnect(host.welcome.token, 10_100);
    const late = directory.reconnect(host.welcome.token, 10_600);
    expect(late).toMatchObject({ code: 'closed' });
  });

  it('rate limits a flood of inputs', () => {
    const directory = new MatchDirectory();
    const host = directory.create('Ada', 1_000);
    if (!('welcome' in host)) throw new Error('host');
    let limited = false;
    for (let i = 1; i < 120; i += 1) {
      const problem = directory.submitInput(host.welcome.token, { ...emptyInput(i, 1, 0), seq: i }, 2_000);
      if (problem?.code === 'rate') limited = true;
    }
    expect(limited).toBe(true);
  });

  it('sends a kill replay after an elimination death', () => {
    const directory = new MatchDirectory();
    const host = directory.create('Ada', 1_000);
    const guest = directory.join('welcome' in host ? host.welcome.code : '', 'Bea', 1_000);
    if (!('welcome' in host) || !('welcome' in guest)) throw new Error('lobby');
    directory.updateSettings(host.welcome.token, { elimination: true, scoreLimit: 20, roundSeconds: 60, weapons: false });
    expect(directory.startMatch(host.welcome.token)).toBeNull();
    for (let i = 0; i < 220; i += 1) directory.pump(1_000 + (i + 1) * 20);
    let replays = 0;
    directory.onReplay(() => {
      replays += 1;
    });
    directory.forceHp(host.welcome.code, guest.playerId, 0, host.playerId);
    directory.pump(1_000 + 221 * 20);
    expect(replays).toBe(1);
  });
});

describe('socket rooms', () => {
  it('two clients see the same damage and a third room stays untouched', async () => {
    const server = await startServer({ port: 0, graceMs: 2_000, corsOrigin: '*' });
    servers.push(server);
    const host = await connect(server.port);
    const guest = await connect(server.port);
    const outsider = await connect(server.port);
    const created = await emitWelcome(host, 'create', { username: 'Ada' });
    const joined = await emitWelcome(guest, 'join', { username: 'Bea', code: created.code });
    const alone = await emitWelcome(outsider, 'create', { username: 'Cleo' });
    expect(joined.code).toBe(created.code);
    expect(alone.code).not.toBe(created.code);

    const hostSnaps = collect(host);
    const guestSnaps = collect(guest);
    const outsiderSnaps = collect(outsider);
    await delay(200);
    const opening = hostSnaps.at(-1);
    const hostX = opening?.fighters.find((fighter) => fighter.id === created.playerId)?.points.hip.x ?? -1;
    const guestX = opening?.fighters.find((fighter) => fighter.id === joined.playerId)?.points.hip.x ?? 1;
    const hostDir = guestX >= hostX ? 1 : -1;
    const started = Date.now();
    while (Date.now() - started < 4000) {
      const n = seq(started);
      host.emit('input', { ...emptyInput(n, hostDir, 0), moveX: hostDir, sprint: true, punch: true, kick: true });
      guest.emit('input', { ...emptyInput(n + 1, -hostDir, 0), moveX: -hostDir, sprint: true, punch: true, kick: true });
      await delay(40);
    }
    await delay(300);
    const shared = matchingTick(hostSnaps, guestSnaps);
    expect(shared).toBeTruthy();
    const ids = new Set(shared?.host.fighters.map((fighter) => fighter.id));
    expect(ids.has(created.playerId)).toBe(true);
    expect(ids.has(joined.playerId)).toBe(true);
    expect(ids.has(alone.playerId)).toBe(false);
    const hurt = (shared?.host.fighters ?? []).some((fighter) => fighter.hp < 100);
    expect(hurt).toBe(true);
    for (const fighter of shared?.host.fighters ?? []) {
      const other = shared?.guest.fighters.find((item) => item.id === fighter.id);
      expect(other?.hp).toBe(fighter.hp);
    }
    const outside = outsiderSnaps.at(-1);
    expect(outside?.fighters.every((fighter) => fighter.hp === 100)).toBe(true);
    expect(outside?.fighters.some((fighter) => fighter.id === created.playerId)).toBe(false);
    host.close();
    guest.close();
    outsider.close();
  });
});

describe('chaos over sockets', () => {
  it('has no account endpoints: old login/register events get no reply and play still works', async () => {
    const server = await startServer({ port: 0, graceMs: 2_000, corsOrigin: '*' });
    servers.push(server);
    const socket = await connect(server.port);
    const replies: string[] = [];
    socket.onAny((event) => replies.push(event));
    socket.emit('login', { username: 'Ada', password: 'whatever-123' });
    socket.emit('register', { username: 'Ada', password: 'whatever-123' });
    socket.emit('profile', {});
    socket.emit('leaderboard');
    await delay(200);
    expect(replies.filter((event) => event !== 'pong')).toEqual([]);
    const created = await emitWelcome(socket, 'create', { username: 'Ada' });
    expect(created.code).toHaveLength(6);
    socket.close();
  });

  it('lets a plain guest open the catalog and hit another player, and shrugs off junk', async () => {
    const server = await startServer({ port: 0, graceMs: 2_000, corsOrigin: '*' });
    servers.push(server);
    const caster = await connect(server.port);
    const victim = await connect(server.port);
    const created = await emitWelcome(caster, 'create', { username: 'Ada' });
    const joined = await emitWelcome(victim, 'join', { username: 'Bea', code: created.code });
    const catalog = await new Promise<{ effects: unknown[] }>((resolve) => {
      caster.once('chaos-catalog', resolve);
      caster.emit('chaos-open');
    });
    expect(catalog.effects).toHaveLength(30);
    const victimSnaps = collect(victim);
    const results: unknown[] = [];
    caster.on('chaos-result', (body) => results.push(body));
    caster.emit('chaos', 'junk');
    caster.emit('chaos', { effect: 'victory', targets: [joined.playerId], duration: 3 });
    await delay(400);
    expect(results).toContainEqual({ error: 'Unknown effect.' });
    expect(results).toContainEqual({ ok: true, effect: 'victory' });
    expect(victimSnaps.some((snap) => snap.fx?.banner === 'YOU WIN')).toBe(true);
    caster.close();
    victim.close();
  });
});

function seq(started: number): number {
  return Math.max(1, Math.round((Date.now() - started) / 16));
}

async function connect(port: number): Promise<Socket> {
  const socket = ioClient(`http://127.0.0.1:${port}`, { transports: ['websocket'] });
  await new Promise<void>((resolve, reject) => {
    socket.on('connect', () => resolve());
    socket.on('connect_error', reject);
  });
  return socket;
}

function emitWelcome(socket: Socket, event: 'create' | 'join', body: object) {
  return new Promise<{ code: string; playerId: string; token: string }>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no welcome for ${event}`)), 4000);
    socket.once('problem', (problem) => {
      clearTimeout(timer);
      reject(new Error(problem.message ?? 'problem'));
    });
    socket.once('welcome', (welcome) => {
      clearTimeout(timer);
      resolve({ code: welcome.code, playerId: welcome.playerId, token: welcome.token });
    });
    socket.emit(event, body);
  });
}

function collect(socket: Socket) {
  const snaps: import('@sfc/shared').NetSnapshot[] = [];
  socket.on('snapshot', (snap) => snaps.push(snap));
  return snaps;
}

function matchingTick(
  host: import('@sfc/shared').NetSnapshot[],
  guest: import('@sfc/shared').NetSnapshot[],
) {
  for (let i = host.length - 1; i >= 0; i -= 1) {
    const left = host[i];
    const right = guest.find((snap) => snap.tick === left?.tick);
    if (left && right) return { host: left, guest: right };
  }
  return null;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
