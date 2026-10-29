import { io, type Socket } from 'socket.io-client';
import type { FighterSnapshot, InputFrame, LobbyState, NetSnapshot, RoomError, Welcome } from '@sfc/shared';
import { Predictor } from './predict.js';

export interface OnlineHooks {
  onWelcome: (welcome: Welcome) => void;
  onLobby: (lobby: LobbyState) => void;
  onProblem: (problem: RoomError) => void;
  onLeft: () => void;
  onAccount?: (payload: { error?: string; token?: string; profile?: AccountProfile | null }) => void;
  onBoard?: (rows: BoardRow[]) => void;
}

export interface AccountProfile {
  username: string;
  xp: number;
  level: number;
  matches: number;
  wins: number;
  losses: number;
  kills: number;
  deaths: number;
  loadout: { color: number; hat: string; face: string };
}

export interface BoardRow {
  username: string;
  level: number;
  xp: number;
  wins: number;
  kills: number;
}

export class OnlineSession {
  private socket: Socket | null = null;
  private predictor: Predictor | null = null;
  readonly buffer: NetSnapshot[] = [];
  welcome: Welcome | null = null;
  lobby: LobbyState | null = null;
  rtt = 80;
  private pingTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly hooks: OnlineHooks) {}

  get localId(): string {
    return this.welcome?.playerId ?? '';
  }

  connect(): void {
    if (this.socket) return;
    const url = import.meta.env.VITE_SERVER_URL || undefined;
    this.socket = io(url, { transports: ['websocket', 'polling'] });
    this.socket.on('welcome', (welcome: Welcome) => {
      this.welcome = welcome;
      this.lobby = welcome.lobby;
      this.predictor = new Predictor(welcome.playerId, welcome.lobby.players.find((p) => p.id === welcome.playerId)?.name ?? 'You', welcome.lobby.players.find((p) => p.id === welcome.playerId)?.color ?? 0);
      this.hooks.onWelcome(welcome);
    });
    this.socket.on('lobby', (lobby: LobbyState) => {
      this.lobby = lobby;
      this.hooks.onLobby(lobby);
    });
    this.socket.on('snapshot', (snap: NetSnapshot) => {
      this.buffer.push(snap);
      if (this.buffer.length > 40) this.buffer.splice(0, this.buffer.length - 40);
      const mine = snap.fighters.find((fighter) => fighter.id === snap.you);
      if (mine) this.predictor?.reconcile(mine, snap.ackSeq);
    });
    this.socket.on('problem', (problem: RoomError) => this.hooks.onProblem(problem));
    this.socket.on('left', () => this.hooks.onLeft());
    this.socket.on('account', (payload: { error?: string; token?: string; profile?: AccountProfile | null }) => this.hooks.onAccount?.(payload));
    this.socket.on('board', (rows: BoardRow[]) => this.hooks.onBoard?.(rows));
    this.socket.on('pong', (sent: number) => {
      if (typeof sent === 'number') this.rtt = Math.max(1, Date.now() - sent);
    });
    this.pingTimer = setInterval(() => this.socket?.emit('ping', Date.now()), 1000);
  }

  create(username: string, account?: string): void {
    this.connect();
    this.socket?.emit('create', { username, account });
  }

  join(username: string, code: string, account?: string): void {
    this.connect();
    this.socket?.emit('join', { username, code, account });
  }

  reconnect(token: string): void {
    this.connect();
    this.socket?.emit('reconnect-token', { token });
  }

  emit(event: string, body?: unknown): void {
    this.socket?.emit(event, body);
  }

  sendInput(input: InputFrame): void {
    this.predictor?.push(input);
    this.socket?.emit('input', input);
  }

  leave(): void {
    this.socket?.emit('leave');
    this.reset();
  }

  close(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
    this.socket?.close();
    this.socket = null;
    this.reset();
  }

  latest(): NetSnapshot | null {
    return this.buffer[this.buffer.length - 1] ?? null;
  }

  /** Two snapshots around render time, for remote interpolation. */
  sample(nowMs: number): { older: NetSnapshot; newer: NetSnapshot; alpha: number } | null {
    if (this.buffer.length === 0) return null;
    const newest = this.buffer[this.buffer.length - 1];
    if (!newest) return null;
    const delay = Math.min(0.4, Math.max(0.08, (this.rtt / 1000) * 1.4));
    const renderTime = newest.time - delay;
    let older = this.buffer[0] ?? newest;
    let newer = newest;
    for (let i = 0; i < this.buffer.length; i += 1) {
      const snap = this.buffer[i];
      if (!snap) continue;
      if (snap.time <= renderTime) older = snap;
      if (snap.time >= renderTime) {
        newer = snap;
        break;
      }
    }
    const span = newer.time - older.time;
    const alpha = span <= 0.0001 ? 1 : Math.min(1, Math.max(0, (renderTime - older.time) / span));
    void nowMs;
    return { older, newer, alpha };
  }

  predicted(): FighterSnapshot | null {
    return this.predictor?.pose() ?? null;
  }

  private reset(): void {
    this.buffer.length = 0;
    this.welcome = null;
    this.lobby = null;
    this.predictor = null;
  }
}
