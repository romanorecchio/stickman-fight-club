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
  sanitizeLoadout,
  sanitizeUsername,
  type InputFrame,
  type LobbyState,
  type NetSnapshot,
  type RoomError,
  type PrivateFx,
  type Snapshot,
  type Welcome,
} from '@sfc/shared';
import { MatchRules, type Loadout, type TeamId } from '@sfc/shared';
import { Simulation } from '@sfc/sim';
import { CHAOS_EFFECTS, ChaosControl } from './chaos.js';

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
  hat: string;
  face: string;
  prefs: { jumpscares: boolean; reduceMotion: boolean; reduceFlash: boolean };
}

interface Room {
  code: string;
  sim: Simulation;
  match: MatchRules;
  mapId: string;
  hostId: string;
  startedAt: number;
  history: Snapshot[];
  deathsSeen: number;
  chaos: ChaosControl;
  chaosPhase: string;
  chaosBanner: boolean;
  fx: Map<string, PrivateFx>;
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
  private replayListener: ((code: string, frames: Snapshot[]) => void) | null = null;
  private readonly graceMs: number;
  private readonly maxPlayers: number;

  constructor(options: RoomOptions = {}) {
    this.graceMs = options.graceMs ?? DEFAULT_GRACE_MS;
    this.maxPlayers = options.maxPlayers ?? MAX_PLAYERS;
  }

  onSnapshot(listener: (code: string, snap: NetSnapshot) => void): void {
    this.listener = listener;
  }

  onReplay(listener: (code: string, frames: Snapshot[]) => void): void {
    this.replayListener = listener;
  }

  forceHp(code: string, id: string, hp: number, attacker: string): void {
    const room = this.rooms.get(code);
    if (!room) return;
    room.sim.setFighterHp(id, hp, room.match.settings.startingHp, attacker);
  }

  setPrefs(token: string, raw: unknown): void {
    const slot = this.slotFor(token);
    if (!slot || !raw || typeof raw !== 'object') return;
    const body = raw as Partial<Slot['prefs']>;
    if (typeof body.jumpscares === 'boolean') slot.prefs.jumpscares = body.jumpscares;
    if (typeof body.reduceMotion === 'boolean') slot.prefs.reduceMotion = body.reduceMotion;
    if (typeof body.reduceFlash === 'boolean') slot.prefs.reduceFlash = body.reduceFlash;
  }

  chaosCatalog(): { effects: { id: string; name: string; tab: string }[] } {
    return { effects: CHAOS_EFFECTS };
  }

  /** Any connected player may cast at players in their own room. */
  chaosCast(roomToken: string, body: unknown): { ok: true; effect: string } | { error: string } | null {
    const room = this.roomFor(roomToken);
    const found = this.tokens.get(roomToken);
    if (!room || !found) return null;
    return room.chaos.cast(found.id, body, [...room.slots.keys()]);
  }

  chaosReset(roomToken: string): { ok: true; effect: string } | null {
    const room = this.roomFor(roomToken);
    const found = this.tokens.get(roomToken);
    if (!room || !found) return null;
    return room.chaos.reset(found.id);
  }

  dismissScare(roomToken: string): void {
    const found = this.tokens.get(roomToken);
    if (found) this.rooms.get(found.code)?.chaos.dismiss(found.id);
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

  /** Every player is a guest: a display name plus an optional look picked in the menu. */
  create(rawName: unknown, rawLook?: unknown, now = Date.now()): Joined | RoomError {
    const clock = typeof rawLook === 'number' ? rawLook : now;
    const look = typeof rawLook === 'number' ? undefined : rawLook;
    const who = this.named(rawName, look);
    if (!who) return { code: 'name', message: 'Enter a name first.' };
    const code = this.freshCode();
    const room = this.blankRoom(code, clock);
    this.rooms.set(code, room);
    return this.takeSlot(room, who, clock);
  }

  join(rawCode: unknown, rawName: unknown, rawLook?: unknown, now = Date.now()): Joined | RoomError {
    const clock = typeof rawLook === 'number' ? rawLook : now;
    const look = typeof rawLook === 'number' ? undefined : rawLook;
    const who = this.named(rawName, look);
    if (!who) return { code: 'name', message: 'Enter a name first.' };
    const code = normalizeCode(rawCode);
    if (!code) return { code: 'not_found', message: 'Room codes are 6 characters.' };
    const room = this.rooms.get(code);
    if (!room) return { code: 'not_found', message: 'No lobby with that code.' };
    if (this.occupants(room) >= this.maxPlayers) return { code: 'full', message: 'That lobby is full (8 fighters).' };
    if (room.match.phase !== 'lobby' && room.match.settings.lateJoin === 'closed') {
      return { code: 'closed', message: 'That match is not taking new fighters.' };
    }
    return this.takeSlot(room, who, clock);
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

  updateSettings(token: string, raw: unknown): RoomError | null {
    const room = this.roomFor(token);
    const slot = this.slotFor(token);
    if (!room || !slot) return { code: 'token', message: 'You are not in a lobby.' };
    if (room.hostId !== slot.id) return { code: 'closed', message: 'Only the host can change settings.' };
    room.match.queueSettings(raw);
    if (raw && typeof raw === 'object' && typeof (raw as { chaosBanner?: unknown }).chaosBanner === 'boolean') {
      room.chaosBanner = (raw as { chaosBanner: boolean }).chaosBanner;
    }
    if (room.match.phase === 'lobby') this.ensureMap(room);
    return null;
  }

  startMatch(token: string): RoomError | null {
    const room = this.roomFor(token);
    const slot = this.slotFor(token);
    if (!room || !slot) return { code: 'token', message: 'You are not in a lobby.' };
    if (room.hostId !== slot.id) return { code: 'closed', message: 'Only the host can start.' };
    this.ensureMap(room);
    const roster = [...room.slots.values()].filter((item) => item.connected).map((item) => ({ id: item.id, name: item.name }));
    const problem = room.match.start(roster);
    if (problem) return { code: 'closed', message: problem };
    for (const item of roster) {
      room.sim.setFighterHp(item.id, room.match.settings.startingHp);
      room.sim.respawnFighter(item.id);
    }
    room.sim.deployWeapons(room.match.settings.weapons, room.match.settings.categories);
    room.sim.resetTallies();
    room.startedAt = Date.now();
    return null;
  }

  private ensureMap(room: Room): void {
    const id = room.match.settings.map;
    if (room.mapId === id) return;
    room.mapId = id;
    room.sim = new Simulation({ roster: 'empty', ai: false, seed: randomInt(1, 1_000_000), mapId: id });
    for (const slot of room.slots.values()) {
      room.sim.addFighter(slot.id, slot.name, slot.color);
      room.sim.setLook(slot.id, { color: slot.color, hat: slot.hat, face: slot.face });
    }
  }

  assignTeam(token: string, team: TeamId): RoomError | null {
    const room = this.roomFor(token);
    const slot = this.slotFor(token);
    if (!room || !slot) return { code: 'token', message: 'You are not in a lobby.' };
    if (room.hostId !== slot.id && room.match.settings.mode === 'tdm') room.match.setTeam(slot.id, team);
    else if (room.hostId === slot.id) room.match.setTeam(slot.id, team);
    else room.match.setTeam(slot.id, team);
    return null;
  }

  private roomFor(token: string): Room | null {
    const found = this.tokens.get(token);
    return found ? (this.rooms.get(found.code) ?? null) : null;
  }

  private slotFor(token: string): Slot | null {
    const found = this.tokens.get(token);
    const room = found ? this.rooms.get(found.code) : null;
    return found && room ? (room.slots.get(found.id) ?? null) : null;
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
        for (const slot of room.slots.values()) {
          const watching = room.match.spectators.has(slot.id) && room.match.phase !== 'lobby';
          inputs.set(slot.id, watching ? emptyInput(slot.lastSeq, slot.lastInput.aimX, slot.lastInput.aimY) : slot.lastInput);
        }
        room.sim.stepAll(FIXED_DT, inputs);
        const roster = room.sim.summaries();
        for (const row of roster) {
          const by = room.sim.hurtBy(row.id);
          if (by) room.match.noteAttacker(row.id, by);
        }
        const action = room.match.tick(FIXED_DT, roster);
        room.sim.setRules(room.match.teams, room.match.settings.friendlyFire);
        for (const id of action.hold) room.sim.setHoldKo(id, true);
        for (const id of action.respawn) {
          room.sim.setHoldKo(id, false);
          room.sim.setFighterHp(id, room.match.settings.startingHp);
          room.sim.respawnFighter(id);
        }
        room.sim.markInfected(room.match.infected);
        const deaths = [...room.match.deaths.values()].reduce((sum, value) => sum + value, 0);
        const replayMode = room.match.settings.elimination || room.match.settings.mode === 'duel';
        if (replayMode && deaths > room.deathsSeen && room.history.length > 0) {
          this.replayListener?.(room.code, room.history.map((frame) => ({ ...frame, fighters: frame.fighters.map((fighter) => ({ ...fighter })) })));
        }
        room.deathsSeen = deaths;
        if (room.chaosPhase !== room.match.phase) {
          if (room.match.phase === 'roundEnd' || room.match.phase === 'lobby') room.chaos.clearRound();
          room.chaosPhase = room.match.phase;
        }
        room.fx = room.chaos.apply(
          room.sim,
          room.sim.summaries().map((row) => {
            const prefs = room.slots.get(row.id)?.prefs;
            return {
              id: row.id,
              hp: row.hp,
              x: row.x,
              y: row.y,
              jumpscares: prefs?.jumpscares !== false,
              reduceMotion: prefs?.reduceMotion === true,
              reduceFlash: prefs?.reduceFlash === true,
            };
          }),
          now,
        );
        room.acc -= FIXED_DT;
        steps += 1;
        if (room.sim.tick % SNAPSHOT_STRIDE === 0) {
          const sample = room.sim.getSnapshot();
          room.history.push(sample);
          if (room.history.length > 36) room.history.shift();
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
    snap.fighters = snap.fighters.filter((fighter) => !fighter.invisible || fighter.id === slot.id);
    return {
      ...snap,
      you: slot.id,
      ackSeq: slot.lastSeq,
      serverNow: now,
      match: room.match.view(),
      fx: room.fx.get(slot.id) ?? null,
    };
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
    room.match.remove(id);
    room.chaos.dropPlayer(id);
    if (room.hostId === id) this.migrateHost(room);
    if (room.slots.size === 0) this.rooms.delete(room.code);
  }

  private migrateHost(room: Room): void {
    const next = [...room.slots.values()]
      .filter((slot) => slot.connected)
      .sort((a, b) => a.joinIndex - b.joinIndex)[0];
    room.hostId = next?.id ?? '';
  }

  private named(rawName: unknown, rawLook: unknown): { name: string; loadout: Loadout | null } | null {
    const name = sanitizeUsername(rawName);
    if (!name) return null;
    // No accounts or levels: every hat, face, and color is open to everyone.
    const loadout = rawLook ? sanitizeLoadout(rawLook, 99) : null;
    return { name, loadout };
  }

  private takeSlot(room: Room, who: { name: string; loadout: Loadout | null }, now: number): Joined {
    const id = `p${randomBytes(4).toString('hex')}`;
    const token = randomBytes(24).toString('base64url');
    const color = who.loadout?.color ?? room.joinCounter % 8;
    const slot: Slot = {
      id,
      name: who.name,
      token,
      color,
      joinIndex: room.joinCounter,
      connected: true,
      disconnectAt: null,
      lastInput: emptyInput(0, color % 2 === 0 ? 1 : -1, 0),
      lastSeq: 0,
      inputStamps: [],
      hat: who.loadout?.hat ?? 'none',
      face: who.loadout?.face ?? 'dot',
      prefs: { jumpscares: true, reduceMotion: false, reduceFlash: false },
    };
    room.joinCounter += 1;
    if (!room.hostId) room.hostId = id;
    room.slots.set(id, slot);
    room.sim.addFighter(id, who.name, color);
    room.sim.setLook(id, { color, hat: slot.hat, face: slot.face });
    if (room.match.phase !== 'lobby' && room.match.settings.lateJoin === 'spectate') room.match.spectators.add(id);
    if (room.match.phase === 'fight' && room.match.settings.lateJoin === 'now') {
      room.match.alive.add(id);
      room.match.lastHp.set(id, room.match.settings.startingHp);
      if (room.match.settings.mode === 'tdm' || room.match.settings.mode === 'koth') room.match.autoTeam(id);
    }
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
      settings: room.match.settings,
      phase: room.match.phase,
      chaosBanner: room.chaosBanner,
      players: [...room.slots.values()]
        .sort((a, b) => a.joinIndex - b.joinIndex)
        .map((slot) => ({
          id: slot.id,
          name: slot.name,
          host: slot.id === room.hostId,
          connected: slot.connected,
          color: slot.color,
          team: room.match.teams.get(slot.id) ?? 'none',
        })),
    };
  }

  private occupants(room: Room): number {
    return room.slots.size;
  }

  private blankRoom(code: string, now: number): Room {
    return {
      code,
      sim: new Simulation({ roster: 'empty', ai: false, seed: randomInt(1, 1_000_000), mapId: 'classic' }),
      match: new MatchRules(),
      mapId: 'classic',
      hostId: '',
      startedAt: now,
      history: [],
      deathsSeen: 0,
      chaos: new ChaosControl(),
      chaosPhase: 'lobby',
      chaosBanner: false,
      fx: new Map(),
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
