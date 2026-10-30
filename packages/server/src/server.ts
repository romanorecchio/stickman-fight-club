import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type ServerResponse } from 'node:http';
import path from 'node:path';
import { Server } from 'socket.io';
import type { LobbyState, NetSnapshot, RoomError, Welcome } from '@sfc/shared';
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
  // No accounts, no database: every socket is a guest identified by the name it picks.
  const directory = new MatchDirectory({ graceMs });
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
    socket.on('create', (body: { username?: string; look?: unknown }) => {
      const result = directory.create(body?.username, lookOf(body));
      if (isError(result)) {
        socket.emit('problem', result);
        return;
      }
      token = result.welcome.token;
      socket.join(result.welcome.code);
      socket.emit('welcome', result.welcome satisfies Welcome);
      pushLobby(result.welcome.code);
    });
    socket.on('join', (body: { username?: string; code?: string; look?: unknown }) => {
      const result = directory.join(body?.code, body?.username, lookOf(body));
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
    socket.on('chaos-open', () => {
      socket.emit('chaos-catalog', directory.chaosCatalog());
    });
    socket.on('chaos', (body: unknown) => {
      if (!token) {
        socket.emit('chaos-result', { error: 'Join a lobby first.' });
        return;
      }
      try {
        socket.emit('chaos-result', directory.chaosCast(token, body) ?? { error: 'Join a lobby first.' });
      } catch (error) {
        console.error('chaos command failed', error);
        socket.emit('chaos-result', { error: 'That did not work.' });
      }
    });
    socket.on('chaos-reset', () => {
      if (!token) return;
      try {
        socket.emit('chaos-result', directory.chaosReset(token) ?? { error: 'Join a lobby first.' });
      } catch (error) {
        console.error('chaos reset failed', error);
      }
    });
    socket.on('dismiss-scare', () => {
      if (!token) return;
      directory.dismissScare(token);
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

function lookOf(body: unknown): object | undefined {
  const look = body && typeof body === 'object' ? (body as { look?: unknown }).look : undefined;
  return look && typeof look === 'object' ? look : undefined;
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
  res.writeHead(200, {
    'content-type': TYPES[path.extname(target)] ?? 'application/octet-stream',
    'cache-control': staticCacheControl(base, target),
  });
  createReadStream(target).pipe(res);
}

/** index.html must revalidate so a deploy's new hashed bundle is picked up; hashed assets can cache forever. */
export function staticCacheControl(base: string, target: string): string {
  const rel = path.relative(base, target).split(path.sep).join('/');
  if (rel.startsWith('assets/')) return 'public, max-age=31536000, immutable';
  return 'no-cache';
}
