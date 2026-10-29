import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type ServerResponse } from 'node:http';
import path from 'node:path';
import { Server } from 'socket.io';
import type { LobbyState, NetSnapshot, RoomError, Welcome } from '@sfc/shared';
import { Accounts } from './accounts.js';
import { ownerPasswordMatches } from './chaos.js';
import { MatchDirectory, type Joined } from './rooms.js';

export interface ListenOptions {
  port?: number;
  corsOrigin?: string | string[];
  graceMs?: number;
  staticDir?: string;
}

export interface RunningServer {
  port: number;
  directory: MatchDirectory;
  close: () => Promise<void>;
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.map': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
};

export async function startServer(options: ListenOptions = {}): Promise<RunningServer> {
  const port = options.port ?? Number(process.env.PORT ?? 4318);
  const corsOrigin =
    options.corsOrigin ??
    (process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : ['http://127.0.0.1:4317', 'http://localhost:4317']);
  const graceMs = options.graceMs ?? Number(process.env.RECONNECT_GRACE_MS ?? 12_000);
  const staticDir = options.staticDir ?? process.env.STATIC_DIR;
  const delayMs = Math.max(0, Number(process.env.SFC_DELAY_MS ?? 0));
  const later = (fn: () => void) => {
    if (delayMs <= 0) fn();
    else setTimeout(fn, delayMs);
  };
  let accounts: Accounts | null = null;
  try {
    accounts = new Accounts();
  } catch (error) {
    console.error('accounts database unavailable', error);
  }
  const directory = new MatchDirectory({ graceMs, accounts: accounts ?? undefined });
  const http = createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, rooms: directory.roomCount() }));
      return;
    }
    if (!staticDir) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found');
      return;
    }
    serveStatic(staticDir, req.url ?? '/', res);
  });
  const io = new Server(http, { cors: { origin: corsOrigin } });

  directory.onSnapshot((code, snap) => {
    later(() => io.to(code).emit('snapshot', snap satisfies NetSnapshot));
  });
  directory.onReplay((code, frames) => {
    io.to(code).emit('replay', frames);
  });

  io.on('connection', (socket) => {
    let token = '';
    const pushLobby = (code: string) => {
      const lobby = directory.lobby(code);
      if (lobby) io.to(code).emit('lobby', lobby satisfies LobbyState);
    };
    socket.on('create', (body: { username?: string; account?: string }) => {
      const result = directory.create(body?.username, body?.account);
      if (isError(result)) {
        socket.emit('problem', result);
        return;
      }
      token = result.welcome.token;
      socket.join(result.welcome.code);
      socket.emit('welcome', result.welcome satisfies Welcome);
      pushLobby(result.welcome.code);
    });
    socket.on('join', (body: { username?: string; code?: string; account?: string }) => {
      const result = directory.join(body?.code, body?.username, body?.account);
      if (isError(result)) {
        socket.emit('problem', result);
        return;
      }
      token = result.welcome.token;
      socket.join(result.welcome.code);
      socket.emit('welcome', result.welcome satisfies Welcome);
      pushLobby(result.welcome.code);
    });
    socket.on('reconnect-token', (body: { token?: string }) => {
      const result = directory.reconnect(body?.token);
      if (isError(result)) {
        socket.emit('problem', result);
        return;
      }
      token = result.welcome.token;
      socket.join(result.welcome.code);
      socket.emit('welcome', result.welcome satisfies Welcome);
      pushLobby(result.welcome.code);
    });
    socket.on('input', (frame: unknown) => {
      if (!token) return;
      later(() => {
        const problem = directory.submitInput(token, frame);
        if (problem?.code === 'rate') socket.emit('problem', problem);
      });
    });
    socket.on('settings', (body: unknown) => {
      if (!token) return;
      const code = directory.codeFor(token);
      const problem = directory.updateSettings(token, body);
      if (problem) socket.emit('problem', problem);
      else if (code) pushLobby(code);
    });
    socket.on('start-match', () => {
      if (!token) return;
      const code = directory.codeFor(token);
      const problem = directory.startMatch(token);
      if (problem) socket.emit('problem', problem);
      else if (code) pushLobby(code);
    });
    const accountResult = (result: { error: string } | { token?: string; profile?: unknown } | { ok: true } | null) => {
      socket.emit('account', result ?? { error: 'Accounts are off.' });
    };
    socket.on('register', (body: { username?: string; password?: string }) => {
      accountResult(accounts ? accounts.register(body?.username, body?.password) : { error: 'Accounts are off.' });
    });
    socket.on('login', (body: { username?: string; password?: string }) => {
      if (accounts && ownerPasswordMatches(body?.username, body?.password)) {
        const minted = accounts.loginOwner(body?.username);
        if ('token' in minted) directory.noteOwner(minted.token);
        accountResult(minted);
        return;
      }
      accountResult(accounts ? accounts.login(body?.username, body?.password) : { error: 'Accounts are off.' });
    });
    socket.on('gate', (body: { account?: string }) => {
      const opened = directory.gate(body?.account);
      if (opened) socket.emit('gate-open', opened);
    });
    socket.on('gate-code', (body: { account?: string; code?: string }) => {
      const result = directory.gateCode(body?.account, body?.code);
      if (result) socket.emit('gate-code', result);
    });
    socket.on('chaos', (body: { account?: string } & Record<string, unknown>) => {
      if (!token) return;
      const result = directory.chaosCast(token, body?.account, body);
      if (result && 'error' in result) socket.emit('gate-code', result);
    });
    socket.on('chaos-reset', (body: { account?: string }) => {
      if (!token) return;
      directory.chaosReset(token, body?.account);
    });
    socket.on('dismiss-scare', () => {
      if (!token) return;
      directory.dismissScare(token);
    });
    socket.on('logout', (body: { token?: string }) => {
      accounts?.logout(body?.token);
      socket.emit('account', { profile: null });
    });
    socket.on('equip', (body: { token?: string; loadout?: unknown }) => {
      const result = directory.equip(body?.token, body?.loadout);
      if ('error' in result) accountResult(result);
      else accountResult(accounts?.profile(body?.token) ? { profile: accounts.profile(body?.token) } : { error: 'Log in first.' });
    });
    socket.on('profile', (body: { token?: string }) => {
      accountResult({ profile: accounts?.profile(body?.token) ?? null });
    });
    socket.on('leaderboard', () => {
      socket.emit('board', accounts?.leaderboard() ?? []);
    });
    socket.on('prefs', (body: unknown) => {
      if (!token) return;
      directory.setPrefs(token, body);
    });
    socket.on('team', (body: { team?: 'red' | 'blue' | 'none' }) => {
      if (!token) return;
      const code = directory.codeFor(token);
      const problem = directory.assignTeam(token, body?.team ?? 'none');
      if (problem) socket.emit('problem', problem);
      else if (code) pushLobby(code);
    });
    socket.on('ping', (sent: number) => {
      later(() => socket.emit('pong', typeof sent === 'number' ? sent : Date.now()));
    });
    socket.on('leave', () => {
      if (!token) return;
      const code = directory.codeFor(token);
      directory.leave(token);
      token = '';
      if (code) pushLobby(code);
      socket.emit('left');
    });
    socket.on('disconnect', () => {
      if (!token) return;
      const code = directory.codeFor(token);
      directory.disconnect(token);
      if (code) pushLobby(code);
    });
  });

  directory.start();
  await new Promise<void>((resolve) => {
    http.listen(port, '0.0.0.0', () => resolve());
  });
  const address = http.address();
  const actual = typeof address === 'object' && address ? address.port : port;
  return {
    port: actual,
    directory,
    close: () =>
      new Promise((done) => {
        directory.stop();
        io.close();
        http.close(() => done());
      }),
  };
}

function isError(value: Joined | RoomError): value is RoomError {
  return 'message' in value && !('welcome' in value);
}

function serveStatic(root: string, url: string, res: ServerResponse): void {
  const clean = decodeURIComponent((url.split('?')[0] ?? '/'));
  const relative = clean === '/' ? 'index.html' : clean.replace(/^\/+/, '');
  const base = path.resolve(root);
  const file = path.resolve(base, relative);
  if (!file.startsWith(base)) {
    res.writeHead(403);
    res.end('forbidden');
    return;
  }
  const target = existsSync(file) && statSync(file).isFile() ? file : path.join(base, 'index.html');
  if (!existsSync(target)) {
    res.writeHead(404);
    res.end('not found');
    return;
  }
  res.writeHead(200, { 'content-type': TYPES[path.extname(target)] ?? 'application/octet-stream' });
  createReadStream(target).pipe(res);
}
