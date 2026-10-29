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
