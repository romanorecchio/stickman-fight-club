import { sanitizeMapId, type MapId } from './maps.js';
import { ALL_CATEGORIES, sanitizeCategories, type WeaponCategories } from './weapons.js';

export type MatchMode = 'ffa' | 'tdm' | 'duel' | 'infection' | 'koth';
export type MatchPhase = 'lobby' | 'countdown' | 'fight' | 'roundEnd' | 'matchEnd';
export type TeamId = 'red' | 'blue' | 'none';

export interface MatchSettings {
  mode: MatchMode;
  roundSeconds: number;
  scoreLimit: number;
  rounds: number;
  elimination: boolean;
  friendlyFire: boolean;
  startingHp: number;
  bestOf: 3 | 5 | 7;
  hillSeconds: number;
  hillMoves: boolean;
  weapons: boolean;
  map: MapId;
  categories: WeaponCategories;
  lateJoin: 'spectate' | 'now' | 'closed';
}

export interface ScoreRow {
  id: string;
  name: string;
  team: TeamId;
  kills: number;
  deaths: number;
  score: number;
  alive: boolean;
  spectating: boolean;
}

export interface MatchView {
  mode: MatchMode;
  phase: MatchPhase;
  timeLeft: number;
  round: number;
  rounds: number;
  scoreLimit: number;
  banner: string | null;
  rows: ScoreRow[];
  winnerId: string | null;
  winnerName: string | null;
  hill: { x: number; y: number; ownerId: string | null; contested: boolean } | null;
}

export const DEFAULT_MATCH: MatchSettings = {
  mode: 'ffa',
  roundSeconds: 90,
  scoreLimit: 10,
  rounds: 1,
  elimination: false,
  friendlyFire: true,
  startingHp: 100,
  bestOf: 3,
  hillSeconds: 8,
  hillMoves: false,
  weapons: true,
  map: 'classic',
  categories: { ...ALL_CATEGORIES },
  lateJoin: 'spectate',
};

const HILL_SPOTS = [-4, -1.5, 1.5, 4];

export function sanitizeSettings(raw: unknown, current: MatchSettings = DEFAULT_MATCH): MatchSettings {
  const body = raw && typeof raw === 'object' ? (raw as Partial<MatchSettings>) : {};
  const mode = body.mode;
  const best = body.bestOf;
  return {
    mode: mode === 'tdm' || mode === 'duel' || mode === 'infection' || mode === 'koth' || mode === 'ffa' ? mode : current.mode,
    roundSeconds: clampInt(body.roundSeconds, 20, 600, current.roundSeconds),
    scoreLimit: clampInt(body.scoreLimit, 1, 100, current.scoreLimit),
    rounds: clampInt(body.rounds, 1, 15, current.rounds),
    elimination: typeof body.elimination === 'boolean' ? body.elimination : current.elimination,
    friendlyFire: typeof body.friendlyFire === 'boolean' ? body.friendlyFire : current.friendlyFire,
    startingHp: clampInt(body.startingHp, 25, 200, current.startingHp),
    bestOf: best === 3 || best === 5 || best === 7 ? best : current.bestOf,
    hillSeconds: clampInt(body.hillSeconds, 3, 30, current.hillSeconds),
    hillMoves: typeof body.hillMoves === 'boolean' ? body.hillMoves : current.hillMoves,
    weapons: typeof body.weapons === 'boolean' ? body.weapons : current.weapons,
    map: body.map === undefined ? current.map : sanitizeMapId(body.map),
    categories: sanitizeCategories(body.categories, current.categories),
    lateJoin: body.lateJoin === 'now' || body.lateJoin === 'closed' || body.lateJoin === 'spectate' ? body.lateJoin : current.lateJoin,
  };
}

export interface FighterTick {
  id: string;
  name: string;
  hp: number;
  state: string;
  x: number;
  y: number;
}

export class MatchRules {
  settings: MatchSettings;
  pending: MatchSettings;
  phase: MatchPhase = 'lobby';
  timeLeft = 0;
  round = 0;
  roundWins = new Map<string, number>();
  kills = new Map<string, number>();
  deaths = new Map<string, number>();
  score = new Map<string, number>();
  teams = new Map<string, TeamId>();
  alive = new Set<string>();
  spectators = new Set<string>();
  infected = new Set<string>();
  lastHp = new Map<string, number>();
  lastAttacker = new Map<string, string>();
  banner: string | null = null;
  winnerId: string | null = null;
  winnerName: string | null = null;
  hillX = 0;
  hillY = 1.2;
  hillOwner: string | null = null;
  hillTimer = 0;
  private names = new Map<string, string>();
  private downFor = new Map<string, number>();
  private duelists: string[] = [];

  constructor(settings: MatchSettings = DEFAULT_MATCH) {
    this.settings = { ...settings };
    this.pending = { ...settings };
  }

  queueSettings(raw: unknown): MatchSettings {
    this.pending = sanitizeSettings(raw, this.pending);
    if (this.phase === 'lobby') this.settings = { ...this.pending };
    return this.settings;
  }

  setTeam(id: string, team: TeamId): void {
    if (team === 'red' || team === 'blue' || team === 'none') this.teams.set(id, team);
  }

  /** Auto-balance when a player joins a team mode. */
  autoTeam(id: string): TeamId {
    const red = [...this.teams.values()].filter((team) => team === 'red').length;
    const blue = [...this.teams.values()].filter((team) => team === 'blue').length;
    const team: TeamId = red <= blue ? 'red' : 'blue';
    this.teams.set(id, team);
    return team;
  }

  remove(id: string): void {
    this.alive.delete(id);
    this.spectators.delete(id);
    this.infected.delete(id);
    this.names.delete(id);
  }

  start(roster: { id: string; name: string }[]): string | null {
    if (this.phase === 'fight' || this.phase === 'countdown') return 'A round is already running.';
    if (this.settings.mode === 'duel' && roster.length < 2) return 'Duels need two fighters.';
    if (roster.length < 2) return 'Need at least two players.';
    this.settings = { ...this.pending };
    this.round = 1;
    this.winnerId = null;
    this.winnerName = null;
    this.kills.clear();
    this.deaths.clear();
    this.score.clear();
    this.roundWins.clear();
    this.duelists = [];
    for (const player of roster) this.names.set(player.id, player.name);
    this.beginRound(roster.map((player) => player.id));
    return null;
  }

  /** Returns ids that should respawn this tick, and ids that must stay down. */
  tick(dt: number, fighters: FighterTick[]): { respawn: string[]; hold: string[] } {
    const respawn: string[] = [];
    const hold: string[] = [];
    for (const fighter of fighters) this.names.set(fighter.id, fighter.name);
    if (this.phase !== 'fight' && this.phase !== 'countdown' && this.phase !== 'roundEnd') {
      return { respawn, hold };
    }
    this.timeLeft = Math.max(0, this.timeLeft - dt);
    if (this.phase === 'countdown') {
      if (this.timeLeft <= 0) {
        this.phase = 'fight';
        this.timeLeft = this.settings.roundSeconds;
        this.banner = 'FIGHT';
      }
      for (const fighter of fighters) if (!this.alive.has(fighter.id)) hold.push(fighter.id);
      return { respawn, hold };
    }
    if (this.phase === 'roundEnd') {
      if (this.timeLeft <= 0) this.afterRound(fighters.map((fighter) => fighter.id));
      for (const fighter of fighters) hold.push(fighter.id);
      return { respawn, hold };
    }
    this.scoreKills(fighters);
    if (this.settings.mode === 'koth') this.scoreHill(dt, fighters);
    const finished = this.roundOver(fighters);
    if (finished) {
      this.phase = 'roundEnd';
      this.timeLeft = 4;
      for (const fighter of fighters) hold.push(fighter.id);
      return { respawn, hold };
    }
    for (const fighter of fighters) {
      const down = fighter.state === 'ko' || fighter.hp <= 0;
      if (this.settings.mode === 'infection' && !this.spectators.has(fighter.id)) {
        if (!down) {
          this.downFor.delete(fighter.id);
          continue;
        }
        this.alive.delete(fighter.id);
        const waited = (this.downFor.get(fighter.id) ?? 0) + dt;
        this.downFor.set(fighter.id, waited);
        if (waited > 1.2) {
          this.downFor.set(fighter.id, 0);
          this.alive.add(fighter.id);
          this.infected.add(fighter.id);
          respawn.push(fighter.id);
        } else hold.push(fighter.id);
        continue;
      }
      if (this.spectators.has(fighter.id) || this.settings.elimination || this.settings.mode === 'duel') {
        if (down) this.alive.delete(fighter.id);
        hold.push(fighter.id);
        continue;
      }
      if (!down) {
        this.downFor.delete(fighter.id);
        continue;
      }
      const waited = (this.downFor.get(fighter.id) ?? 0) + dt;
      this.downFor.set(fighter.id, waited);
      if (waited > 1.4) {
        this.downFor.set(fighter.id, 0);
        this.alive.add(fighter.id);
        respawn.push(fighter.id);
      } else hold.push(fighter.id);
    }
    return { respawn, hold };
  }

  noteAttacker(victimId: string, attackerId: string): void {
    if (victimId !== attackerId) this.lastAttacker.set(victimId, attackerId);
  }

  view(): MatchView {
    const rows: ScoreRow[] = [...this.names.entries()].map(([id, name]) => ({
      id,
      name,
      team: this.teams.get(id) ?? 'none',
      kills: this.kills.get(id) ?? 0,
      deaths: this.deaths.get(id) ?? 0,
      score: this.score.get(id) ?? 0,
      alive: this.alive.has(id),
      spectating: this.spectators.has(id),
    }));
    rows.sort((a, b) => b.score - a.score || b.kills - a.kills);
    return {
      mode: this.settings.mode,
      phase: this.phase,
      timeLeft: this.timeLeft,
      round: this.round,
      rounds: this.settings.mode === 'duel' ? this.settings.bestOf : this.settings.rounds,
      scoreLimit: this.settings.scoreLimit,
      banner: this.banner,
      rows,
      winnerId: this.winnerId,
      winnerName: this.winnerName,
      hill:
        this.settings.mode === 'koth'
          ? { x: this.hillX, y: this.hillY, ownerId: this.hillOwner, contested: this.hillOwner === null && this.phase === 'fight' }
          : null,
    };
  }

  private beginRound(ids: string[]): void {
    this.alive.clear();
    this.spectators.clear();
    this.infected.clear();
    this.lastHp.clear();
    const duelists = this.settings.mode === 'duel' ? this.duelPair(ids) : ids;
    for (const id of ids) {
      if (!duelists.includes(id)) this.spectators.add(id);
      else this.alive.add(id);
      this.lastHp.set(id, this.settings.startingHp);
    }
    if (this.settings.mode === 'infection' && duelists.length >= 2) {
      this.infected.add(duelists[0] ?? '');
    }
    if (this.settings.mode === 'tdm' || this.settings.mode === 'koth') {
      for (const id of duelists) if (!this.teams.get(id) || this.teams.get(id) === 'none') this.autoTeam(id);
    }
    this.hillX = 0;
    this.hillTimer = 0;
    this.hillOwner = null;
    this.phase = 'countdown';
    this.timeLeft = 3;
    this.banner = `ROUND ${this.round}`;
  }

  private duelPair(ids: string[]): string[] {
    const present = this.duelists.filter((id) => ids.includes(id));
    if (present.length < 2) this.duelists = ids.slice(0, 2);
    return this.duelists.filter((id) => ids.includes(id)).slice(0, 2);
  }

  private scoreKills(fighters: FighterTick[]): void {
    for (const fighter of fighters) {
      if (this.spectators.has(fighter.id)) continue;
      const prev = this.lastHp.get(fighter.id) ?? this.settings.startingHp;
      if (prev > 0 && fighter.hp <= 0) {
        this.deaths.set(fighter.id, (this.deaths.get(fighter.id) ?? 0) + 1);
        const attacker = this.lastAttacker.get(fighter.id);
        if (attacker && attacker !== fighter.id && !this.sameTeam(attacker, fighter.id)) {
          this.kills.set(attacker, (this.kills.get(attacker) ?? 0) + 1);
          this.score.set(attacker, (this.score.get(attacker) ?? 0) + 1);
        }
        if (this.settings.mode === 'infection') this.infected.add(fighter.id);
        this.alive.delete(fighter.id);
      }
      this.lastHp.set(fighter.id, fighter.hp);
    }
  }

  private scoreHill(dt: number, fighters: FighterTick[]): void {
    const inside = fighters.filter(
      (fighter) => this.alive.has(fighter.id) && Math.abs(fighter.x - this.hillX) < 1.3 && fighter.y < this.hillY + 1.6,
    );
    const teams = new Set(inside.map((fighter) => this.teams.get(fighter.id) ?? fighter.id));
    if (inside.length === 1 && inside[0]) {
      this.hillOwner = inside[0].id;
      this.score.set(inside[0].id, (this.score.get(inside[0].id) ?? 0) + dt);
    } else if (inside.length > 1 && teams.size === 1 && inside[0]) {
      this.hillOwner = inside[0].id;
      const team = this.teams.get(inside[0].id) ?? 'none';
      for (const fighter of fighters) {
        if ((this.teams.get(fighter.id) ?? 'none') === team) {
          this.score.set(fighter.id, (this.score.get(fighter.id) ?? 0) + dt);
        }
      }
    } else {
      this.hillOwner = null;
    }
    if (this.settings.hillMoves) {
      this.hillTimer += dt;
      if (this.hillTimer > this.settings.hillSeconds) {
        this.hillTimer = 0;
        this.hillX = HILL_SPOTS[Math.floor(Math.random() * HILL_SPOTS.length)] ?? 0;
      }
    }
  }

  private roundOver(fighters: FighterTick[]): boolean {
    if (this.timeLeft <= 0 && this.settings.mode !== 'duel') {
      this.banner = this.leadName() ? `${this.leadName()} LEADS` : 'TIME';
      if (this.settings.mode !== 'ffa' || this.settings.rounds > 1) this.awardRoundWin();
      return true;
    }
    if (this.settings.mode === 'duel') {
      const active = fighters.filter((fighter) => !this.spectators.has(fighter.id));
      const standing = active.filter((fighter) => fighter.hp > 0 && fighter.state !== 'ko');
      if (standing.length <= 1 && active.length >= 2) {
        const winner = standing[0];
        if (winner) {
          this.roundWins.set(winner.id, (this.roundWins.get(winner.id) ?? 0) + 1);
          this.score.set(winner.id, this.roundWins.get(winner.id) ?? 0);
          this.banner = `${winner.name} TAKES THE ROUND`;
        } else this.banner = 'DRAW ROUND';
        return true;
      }
    }
    if (this.settings.mode === 'infection') {
      const survivors = [...this.alive].filter((id) => !this.infected.has(id));
      if (survivors.length === 0) {
        this.banner = 'INFECTION WINS';
        return true;
      }
      if (this.timeLeft <= 0 && survivors.length > 0) {
        this.banner = 'SURVIVORS WIN';
        return true;
      }
    }
    if (this.settings.elimination && this.settings.mode === 'ffa') {
      const standing = fighters.filter((fighter) => this.alive.has(fighter.id) && fighter.hp > 0);
      if (standing.length <= 1 && fighters.length >= 2) {
        this.banner = standing[0] ? `${standing[0].name} WINS THE ROUND` : 'DRAW';
        if (standing[0]) this.roundWins.set(standing[0].id, (this.roundWins.get(standing[0].id) ?? 0) + 1);
        return true;
      }
    }
    const top = Math.max(0, ...[...this.score.values()]);
    if (this.settings.mode !== 'duel' && this.settings.mode !== 'infection' && top >= this.settings.scoreLimit) {
      this.banner = `${this.leadName() ?? 'SOMEONE'} HITS ${this.settings.scoreLimit}`;
      this.awardRoundWin();
      return true;
    }
    return false;
  }

  private afterRound(ids: string[]): void {
    const needed = this.settings.mode === 'duel' ? Math.ceil(this.settings.bestOf / 2) : this.settings.rounds;
    const best = Math.max(0, ...[...this.roundWins.values()]);
    if (this.settings.mode === 'duel' && best >= needed) {
      this.finishMatch();
      return;
    }
    if (this.settings.mode !== 'duel' && this.round >= this.settings.rounds) {
      this.finishMatch();
      return;
    }
    this.round += 1;
    this.beginRound(ids);
  }

  private finishMatch(): void {
    this.phase = 'matchEnd';
    this.timeLeft = 6;
    const id = this.leadId();
    this.winnerId = id;
    this.winnerName = id ? (this.names.get(id) ?? null) : null;
    this.banner = this.winnerName ? `${this.winnerName} WINS` : 'DRAW';
  }

  private awardRoundWin(): void {
    const id = this.leadId();
    if (id) this.roundWins.set(id, (this.roundWins.get(id) ?? 0) + 1);
  }

  private leadId(): string | null {
    let bestId: string | null = null;
    let best = -1;
    const source = this.settings.mode === 'duel' ? this.roundWins : this.score;
    for (const [id, value] of source) {
      if (value > best) {
        best = value;
        bestId = id;
      }
    }
    return bestId;
  }

  private leadName(): string | null {
    const id = this.leadId();
    return id ? (this.names.get(id) ?? null) : null;
  }

  private sameTeam(a: string, b: string): boolean {
    if (this.settings.mode !== 'tdm' && this.settings.mode !== 'koth') return false;
    if (this.settings.friendlyFire) return false;
    const ta = this.teams.get(a) ?? 'none';
    const tb = this.teams.get(b) ?? 'none';
    return ta !== 'none' && ta === tb;
  }
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}
