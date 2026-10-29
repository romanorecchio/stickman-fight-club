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

  io.on('connection', (socket) => {
    let token = '';
    const pushLobby = (code: string) => {
      const lobby = directory.lobby(code);
      if (lobby) io.to(code).emit('lobby', lobby satisfies LobbyState);
    };
    socket.on('create', (body: { username?: string }) => {
      const result = directory.create(body?.username);
      if (isError(result)) {
        socket.emit('problem', result);
        return;
      }
      token = result.welcome.token;
      socket.join(result.welcome.code);
      socket.emit('welcome', result.welcome satisfies Welcome);
      pushLobby(result.welcome.code);
    });
    socket.on('join', (body: { username?: string; code?: string }) => {
      const result = directory.join(body?.code, body?.username);
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
