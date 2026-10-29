import { clamp } from './math.js';
import type { InputFrame, Snapshot } from './types.js';

export const MAX_PLAYERS = 8;
export const ROOM_CODE_LENGTH = 6;
export const SNAPSHOT_STRIDE = 3;
export const DEFAULT_GRACE_MS = 12_000;
export const INPUTS_PER_SECOND = 90;
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export interface LobbyPlayer {
  id: string;
  name: string;
  host: boolean;
  connected: boolean;
  color: number;
}

export interface LobbyState {
  code: string;
  hostId: string;
  players: LobbyPlayer[];
  maxPlayers: number;
}

export interface Welcome {
  playerId: string;
  token: string;
  code: string;
  hostId: string;
  lobby: LobbyState;
}

/** Authoritative world plus the ack for this client's inputs. */
export interface NetSnapshot extends Snapshot {
  you: string;
  ackSeq: number;
  serverNow: number;
}

export interface RoomError {
  code: 'name' | 'not_found' | 'full' | 'token' | 'rate' | 'closed';
  message: string;
}

export function sanitizeUsername(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const cleaned = raw
    .replace(/[<>&"'`]/g, '')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 16);
  if (cleaned.length < 1) return null;
  return cleaned;
}

export function normalizeRoomCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const code = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code.length !== ROOM_CODE_LENGTH) return null;
  return code;
}

export function sanitizeInput(raw: unknown, lastSeq: number): InputFrame | null {
  if (!raw || typeof raw !== 'object') return null;
  const frame = raw as Partial<InputFrame>;
  const seq = Number(frame.seq);
  if (!Number.isFinite(seq) || seq <= lastSeq || seq > lastSeq + 32) return null;
  const aimX = Number(frame.aimX);
  const aimY = Number(frame.aimY);
  return {
    seq,
    moveX: clamp(Number(frame.moveX) || 0, -1, 1),
    jump: frame.jump === true,
    crouch: frame.crouch === true,
    sprint: frame.sprint === true,
    punch: frame.punch === true,
    kick: frame.kick === true,
    block: frame.block === true,
    grab: frame.grab === true,
    throw: frame.throw === true,
    aimX: Number.isFinite(aimX) ? clamp(aimX, -40, 40) : 1,
    aimY: Number.isFinite(aimY) ? clamp(aimY, -40, 40) : 0,
  };
}

export function allowInput(stamps: number[], now: number): boolean {
  const recent = stamps.filter((stamp) => now - stamp < 1000);
  stamps.length = 0;
  stamps.push(...recent);
  if (stamps.length >= INPUTS_PER_SECOND) return false;
  stamps.push(now);
  return true;
}
