import { randomBytes, randomInt } from 'node:crypto';
import {
  CODE_ALPHABET,
  DEFAULT_GRACE_MS,
  FIXED_DT,
  MAX_PLAYERS,
  ROOM_CODE_LENGTH,
  SNAPSHOT_STRIDE,
  allowInput,
  emptyInput,
  sanitizeInput,
  sanitizeUsername,
  type InputFrame,
  type LobbyState,
  type NetSnapshot,
  type RoomError,
  type Welcome,
} from '@sfc/shared';
import { Simulation } from '@sfc/sim';

export interface Joined {
  welcome: Welcome;
  playerId: string;
}

export interface RoomOptions {
  graceMs?: number;
  maxPlayers?: number;
}

interface Slot {
  id: string;
  name: string;
  token: string;
  color: number;
  joinIndex: number;
  connected: boolean;
  disconnectAt: number | null;
  lastInput: InputFrame;
  lastSeq: number;
  inputStamps: number[];
}

interface Room {
  code: string;
  sim: Simulation;
  hostId: string;
  slots: Map<string, Slot>;
  joinCounter: number;
  acc: number;
  last: number;
}

export class MatchDirectory {
  private readonly rooms = new Map<string, Room>();
  private readonly tokens = new Map<string, { code: string; id: string }>();
  private timer: NodeJS.Timeout | null = null;
  private listener: ((code: string, snap: NetSnapshot) => void) | null = null;
  private readonly graceMs: number;
  private readonly maxPlayers: number;

  constructor(options: RoomOptions = {}) {
    this.graceMs = options.graceMs ?? DEFAULT_GRACE_MS;
    this.maxPlayers = options.maxPlayers ?? MAX_PLAYERS;
  }

  onSnapshot(listener: (code: string, snap: NetSnapshot) => void): void {
    this.listener = listener;
  }

  codeFor(token: string): string | null {
    return this.tokens.get(token)?.code ?? null;
  }

  start(): void {
    if (this.timer) return;
    const loop = () => {
      this.pump(Date.now());
      this.timer = setTimeout(loop, 4);
    };
    this.timer = setTimeout(loop, 4);
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  create(rawName: unknown, now = Date.now()): Joined | RoomError {
    const name = sanitizeUsername(rawName);
    if (!name) return { code: 'name', message: 'Enter a name first.' };
    const code = this.freshCode();
    const room = this.blankRoom(code, now);
    this.rooms.set(code, room);
    return this.takeSlot(room, name, now);
  }

  join(rawCode: unknown, rawName: unknown, now = Date.now()): Joined | RoomError {
    const name = sanitizeUsername(rawName);
    if (!name) return { code: 'name', message: 'Enter a name first.' };
    const code = normalizeCode(rawCode);
    if (!code) return { code: 'not_found', message: 'Room codes are 6 characters.' };
    const room = this.rooms.get(code);
    if (!room) return { code: 'not_found', message: 'No lobby with that code.' };
    if (this.occupants(room) >= this.maxPlayers) return { code: 'full', message: 'That lobby is full (8 fighters).' };
    return this.takeSlot(room, name, now);
  }

  reconnect(token: unknown, now = Date.now()): Joined | RoomError {
    if (typeof token !== 'string' || token.length < 16) return { code: 'token', message: 'That reconnect token is not valid.' };
    const found = this.tokens.get(token);
    if (!found) return { code: 'token', message: 'That reconnect token is not valid.' };
    const room = this.rooms.get(found.code);
    const slot = room?.slots.get(found.id);
    if (!room || !slot) return { code: 'closed', message: 'That lobby has closed.' };
    if (!slot.connected && slot.disconnectAt !== null && now - slot.disconnectAt > this.graceMs) {
      this.dropSlot(room, slot.id);
      return { code: 'closed', message: 'The reconnect window closed.' };
    }
    slot.connected = true;
    slot.disconnectAt = null;
    return { welcome: this.welcome(room, slot), playerId: slot.id };
  }

  disconnect(token: string, now = Date.now()): void {
    const found = this.tokens.get(token);
    if (!found) return;
    const room = this.rooms.get(found.code);
    const slot = room?.slots.get(found.id);
    if (!room || !slot || !slot.connected) return;
    slot.connected = false;
    slot.disconnectAt = now;
    slot.lastInput = emptyInput(slot.lastSeq, slot.lastInput.aimX, slot.lastInput.aimY);
    if (room.hostId === slot.id) this.migrateHost(room);
  }

  leave(token: string): void {
    const found = this.tokens.get(token);
    if (!found) return;
    const room = this.rooms.get(found.code);
    if (!room) return;
    this.dropSlot(room, found.id);
  }

  submitInput(token: string, raw: unknown, now = Date.now()): RoomError | null {
    const found = this.tokens.get(token);
    if (!found) return { code: 'token', message: 'You are not in a lobby.' };
    const room = this.rooms.get(found.code);
    const slot = room?.slots.get(found.id);
    if (!room || !slot || !slot.connected) return { code: 'closed', message: 'You are not connected.' };
    if (!allowInput(slot.inputStamps, now)) return { code: 'rate', message: 'Input rate limited.' };
    const input = sanitizeInput(raw, slot.lastSeq);
    if (!input) return null;
    slot.lastInput = input;
    slot.lastSeq = input.seq;
    return null;
  }

  lobby(code: string): LobbyState | null {
    const room = this.rooms.get(code);
    return room ? this.lobbyState(room) : null;
  }

  roomCount(): number {
    return this.rooms.size;
  }

  pump(now: number): NetSnapshot[] {
    const emitted: NetSnapshot[] = [];
    for (const room of [...this.rooms.values()]) {
      this.expire(room, now);
      if (room.slots.size === 0) {
        this.rooms.delete(room.code);
        continue;
      }
      const dt = Math.min(0.1, (now - room.last) / 1000);
      room.last = now;
      room.acc += dt;
      let steps = 0;
      while (room.acc >= FIXED_DT && steps < 5) {
        const inputs = new Map<string, InputFrame>();
        for (const slot of room.slots.values()) inputs.set(slot.id, slot.lastInput);
        room.sim.stepAll(FIXED_DT, inputs);
        room.acc -= FIXED_DT;
        steps += 1;
        if (room.sim.tick % SNAPSHOT_STRIDE === 0) {
          for (const slot of room.slots.values()) {
            if (!slot.connected) continue;
            const snap = this.snapshotFor(room, slot, now);
            emitted.push(snap);
            this.listener?.(room.code, snap);
          }
        }
      }
    }
    return emitted;
  }

  private snapshotFor(room: Room, slot: Slot, now: number): NetSnapshot {
    const snap = room.sim.getSnapshot(slot.id);
    return { ...snap, you: slot.id, ackSeq: slot.lastSeq, serverNow: now };
  }

  private expire(room: Room, now: number): void {
    for (const slot of [...room.slots.values()]) {
      if (slot.connected || slot.disconnectAt === null) continue;
      if (now - slot.disconnectAt < this.graceMs) continue;
      this.dropSlot(room, slot.id);
    }
  }

  private dropSlot(room: Room, id: string): void {
    const slot = room.slots.get(id);
    if (!slot) return;
    this.tokens.delete(slot.token);
    room.slots.delete(id);
    room.sim.removeFighter(id);
    if (room.hostId === id) this.migrateHost(room);
    if (room.slots.size === 0) this.rooms.delete(room.code);
  }

  private migrateHost(room: Room): void {
    const next = [...room.slots.values()]
      .filter((slot) => slot.connected)
      .sort((a, b) => a.joinIndex - b.joinIndex)[0];
    room.hostId = next?.id ?? '';
  }

  private takeSlot(room: Room, name: string, now: number): Joined {
    const id = `p${randomBytes(4).toString('hex')}`;
    const token = randomBytes(24).toString('base64url');
    const color = room.joinCounter % 8;
    const slot: Slot = {
      id,
      name,
      token,
      color,
      joinIndex: room.joinCounter,
      connected: true,
      disconnectAt: null,
      lastInput: emptyInput(0, color % 2 === 0 ? 1 : -1, 0),
      lastSeq: 0,
      inputStamps: [],
    };
    room.joinCounter += 1;
    if (!room.hostId) room.hostId = id;
    room.slots.set(id, slot);
    room.sim.addFighter(id, name, color);
    this.tokens.set(token, { code: room.code, id });
    room.last = now;
    return { welcome: this.welcome(room, slot), playerId: id };
  }

  private welcome(room: Room, slot: Slot): Welcome {
    return {
      playerId: slot.id,
      token: slot.token,
      code: room.code,
      hostId: room.hostId,
      lobby: this.lobbyState(room),
    };
  }

  private lobbyState(room: Room): LobbyState {
    return {
      code: room.code,
      hostId: room.hostId,
      maxPlayers: this.maxPlayers,
      players: [...room.slots.values()]
        .sort((a, b) => a.joinIndex - b.joinIndex)
        .map((slot) => ({
          id: slot.id,
          name: slot.name,
          host: slot.id === room.hostId,
          connected: slot.connected,
          color: slot.color,
        })),
    };
  }

  private occupants(room: Room): number {
    return room.slots.size;
  }

  private blankRoom(code: string, now: number): Room {
    return {
      code,
      sim: new Simulation({ roster: 'empty', ai: false, seed: randomInt(1, 1_000_000) }),
      hostId: '',
      slots: new Map(),
      joinCounter: 0,
      acc: 0,
      last: now,
    };
  }

  private freshCode(): string {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      let code = '';
      for (let i = 0; i < ROOM_CODE_LENGTH; i += 1) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
      if (!this.rooms.has(code)) return code;
    }
    return randomBytes(4).toString('hex').toUpperCase().slice(0, ROOM_CODE_LENGTH);
  }
}

function normalizeCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const code = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code.length !== ROOM_CODE_LENGTH) return null;
  for (const char of code) if (!CODE_ALPHABET.includes(char)) return null;
  return code;
}
