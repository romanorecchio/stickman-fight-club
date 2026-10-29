import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { levelForXp, sanitizeLoadout, sanitizeUsername, type Loadout } from '@sfc/shared';

const nodeRequire = createRequire(import.meta.url);

interface SqlStatement {
  run(...args: unknown[]): { lastInsertRowid: number | bigint };
  get(...args: unknown[]): unknown;
  all(...args: unknown[]): unknown[];
}

interface SqlDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqlStatement;
}

function openDatabase(file: string): SqlDatabase {
  const sqlite = nodeRequire('node:' + 'sqlite') as { DatabaseSync: new (file: string) => SqlDatabase };
  return new sqlite.DatabaseSync(file);
}

export interface Profile {
  username: string;
  xp: number;
  level: number;
  matches: number;
  wins: number;
  losses: number;
  kills: number;
  deaths: number;
  damageDealt: number;
  damageTaken: number;
  playSeconds: number;
  bestStreak: number;
  streak: number;
  kothPoints: number;
  infectionWins: number;
  duelWins: number;
  loadout: Loadout;
}

export interface MatchCredit {
  userId: number;
  won: boolean;
  kills: number;
  deaths: number;
  damageDealt: number;
  damageTaken: number;
  playSeconds: number;
  kothPoints: number;
  infectionWin: boolean;
  duelWin: boolean;
  idle: boolean;
}

interface UserRow {
  id: number;
  username: string;
  salt: string;
  hash: string;
  xp: number;
  matches: number;
  wins: number;
  losses: number;
  kills: number;
  deaths: number;
  damage_dealt: number;
  damage_taken: number;
  play_seconds: number;
  best_streak: number;
  streak: number;
  koth_points: number;
  infection_wins: number;
  duel_wins: number;
  color: number;
  hat: string;
  face: string;
}

const SESSION_MS = 12 * 60 * 60 * 1000;

export class Accounts {
  private readonly db: SqlDatabase;
  private readonly fails = new Map<string, { n: number; until: number }>();

  constructor(file = process.env.SFC_DB ?? path.join('data', 'accounts.sqlite')) {
    mkdirSync(path.dirname(file), { recursive: true });
    this.db = openDatabase(file);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        salt TEXT NOT NULL,
        hash TEXT NOT NULL,
        xp INTEGER NOT NULL DEFAULT 0,
        matches INTEGER NOT NULL DEFAULT 0,
        wins INTEGER NOT NULL DEFAULT 0,
        losses INTEGER NOT NULL DEFAULT 0,
        kills INTEGER NOT NULL DEFAULT 0,
        deaths INTEGER NOT NULL DEFAULT 0,
        damage_dealt INTEGER NOT NULL DEFAULT 0,
        damage_taken INTEGER NOT NULL DEFAULT 0,
        play_seconds INTEGER NOT NULL DEFAULT 0,
        best_streak INTEGER NOT NULL DEFAULT 0,
        streak INTEGER NOT NULL DEFAULT 0,
        koth_points INTEGER NOT NULL DEFAULT 0,
        infection_wins INTEGER NOT NULL DEFAULT 0,
        duel_wins INTEGER NOT NULL DEFAULT 0,
        color INTEGER NOT NULL DEFAULT 0,
        hat TEXT NOT NULL DEFAULT 'none',
        face TEXT NOT NULL DEFAULT 'dot'
      );
      CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        expires INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS chaos_audit (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        at INTEGER NOT NULL,
        actor TEXT NOT NULL,
        action TEXT NOT NULL,
        detail TEXT NOT NULL
      );
    `);
  }

  register(rawName: unknown, rawPassword: unknown, now = Date.now()): { token: string; profile: Profile } | { error: string } {
    const username = sanitizeUsername(rawName);
    if (!username) return { error: 'Use a name of 1–16 letters.' };
    const password = typeof rawPassword === 'string' ? rawPassword : '';
    if (password.length < 8 || password.length > 72) return { error: 'Passwords are 8–72 characters.' };
    if (this.locked(username, now)) return { error: 'Too many attempts. Wait and try again.' };
    const existing = this.db.prepare('SELECT id FROM users WHERE username = ?').get(username) as { id: number } | undefined;
    if (existing) return { error: 'That name is already registered.' };
    const salt = randomBytes(16).toString('hex');
    const hash = scryptSync(password, salt, 32).toString('hex');
    const result = this.db.prepare('INSERT INTO users (username, salt, hash) VALUES (?, ?, ?)').run(username, salt, hash);
    const id = Number(result.lastInsertRowid);
    return { token: this.issue(id, now), profile: this.profileById(id)! };
  }

  login(rawName: unknown, rawPassword: unknown, now = Date.now()): { token: string; profile: Profile } | { error: string } {
    const username = sanitizeUsername(rawName);
    const password = typeof rawPassword === 'string' ? rawPassword : '';
    if (!username || !password) return { error: 'Name and password required.' };
    if (this.locked(username, now)) return { error: 'Too many attempts. Wait and try again.' };
    const row = this.db.prepare('SELECT * FROM users WHERE username = ?').get(username) as UserRow | undefined;
    if (!row || !this.check(password, row.salt, row.hash)) {
      this.fail(username, now);
      return { error: 'That name or password does not match.' };
    }
    this.fails.delete(username.toLowerCase());
    return { token: this.issue(row.id, now), profile: toProfile(row) };
  }

  logout(token: unknown): void {
    if (typeof token !== 'string') return;
    this.db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  }

  profile(token: unknown, now = Date.now()): Profile | null {
    const id = this.userId(token, now);
    return id === null ? null : this.profileById(id);
  }

  userId(token: unknown, now = Date.now()): number | null {
    if (typeof token !== 'string' || token.length < 20) return null;
    const row = this.db.prepare('SELECT user_id, expires FROM sessions WHERE token = ?').get(token) as { user_id: number; expires: number } | undefined;
    if (!row || row.expires < now) {
      if (row) this.db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
      return null;
    }
    return row.user_id;
  }

  equip(token: unknown, raw: unknown, now = Date.now()): { profile: Profile } | { error: string } {
    const id = this.userId(token, now);
    if (id === null) return { error: 'Log in first.' };
    const current = this.profileById(id);
    if (!current) return { error: 'Log in first.' };
    const next = sanitizeLoadout(raw, current.level, current.loadout);
    if (!next) return { error: 'That color or hat is still locked.' };
    this.db.prepare('UPDATE users SET color = ?, hat = ?, face = ? WHERE id = ?').run(next.color, next.hat, next.face, id);
    return { profile: this.profileById(id)! };
  }

  loadoutFor(userId: number): Loadout {
    return this.profileById(userId)?.loadout ?? { color: 0, hat: 'none', face: 'dot' };
  }

  record(credits: MatchCredit[]): void {
    const update = this.db.prepare(`
      UPDATE users SET
        xp = xp + ?,
        matches = matches + 1,
        wins = wins + ?,
        losses = losses + ?,
        kills = kills + ?,
        deaths = deaths + ?,
        damage_dealt = damage_dealt + ?,
        damage_taken = damage_taken + ?,
        play_seconds = play_seconds + ?,
        streak = ?,
        best_streak = ?,
        koth_points = koth_points + ?,
        infection_wins = infection_wins + ?,
        duel_wins = duel_wins + ?
      WHERE id = ?
    `);
    for (const credit of credits) {
      const row = this.db.prepare('SELECT streak, best_streak FROM users WHERE id = ?').get(credit.userId) as { streak: number; best_streak: number } | undefined;
      if (!row || credit.idle) continue;
      const xp = credit.won ? 40 : 15;
      const killXp = credit.kills * 5;
      const hillXp = Math.min(40, Math.floor(credit.kothPoints));
      const bonus = (credit.infectionWin ? 20 : 0) + (credit.duelWin ? 15 : 0);
      const streak = credit.won ? row.streak + 1 : 0;
      const best = Math.max(row.best_streak, streak);
      update.run(
        xp + killXp + hillXp + bonus,
        credit.won ? 1 : 0,
        credit.won ? 0 : 1,
        credit.kills,
        credit.deaths,
        Math.round(credit.damageDealt),
        Math.round(credit.damageTaken),
        Math.round(credit.playSeconds),
        streak,
        best,
        Math.round(credit.kothPoints),
        credit.infectionWin ? 1 : 0,
        credit.duelWin ? 1 : 0,
        credit.userId,
      );
    }
  }

  /** Session for the env-authenticated owner. Does not store their password. */
  loginOwner(rawName: unknown, now = Date.now()): { token: string; profile: Profile } | { error: string } {
    const username = sanitizeUsername(rawName);
    if (!username) return { error: 'Name and password required.' };
    const existing = this.db.prepare('SELECT id FROM users WHERE username = ?').get(username) as { id: number } | undefined;
    let id = existing?.id;
    if (!id) {
      const salt = randomBytes(16).toString('hex');
      const hash = scryptSync(randomBytes(32), salt, 32).toString('hex');
      const result = this.db.prepare('INSERT INTO users (username, salt, hash) VALUES (?, ?, ?)').run(username, salt, hash);
      id = Number(result.lastInsertRowid);
    }
    return { token: this.issue(id, now), profile: this.profileById(id)! };
  }

  audit(actor: string, action: string, detail: string): void {
    this.db.prepare('INSERT INTO chaos_audit (at, actor, action, detail) VALUES (?, ?, ?, ?)').run(
      Date.now(),
      actor.slice(0, 32),
      action.slice(0, 80),
      detail.slice(0, 180),
    );
  }

  recentAudit(limit = 20): { action: string; detail: string }[] {
    return this.db.prepare('SELECT action, detail FROM chaos_audit ORDER BY id DESC LIMIT ?').all(limit) as { action: string; detail: string }[];
  }

  leaderboard(limit = 10): { username: string; level: number; xp: number; wins: number; kills: number }[] {
    const rows = this.db.prepare(
      'SELECT username, xp, wins, kills FROM users ORDER BY xp DESC, wins DESC LIMIT ?',
    ).all(Math.max(1, Math.min(20, limit))) as { username: string; xp: number; wins: number; kills: number }[];
    return rows.map((row) => ({ ...row, level: levelForXp(row.xp) }));
  }

  private profileById(id: number): Profile | null {
    const row = this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
    return row ? toProfile(row) : null;
  }

  private issue(userId: number, now: number): string {
    const token = randomBytes(24).toString('base64url');
    this.db.prepare('INSERT INTO sessions (token, user_id, expires) VALUES (?, ?, ?)').run(token, userId, now + SESSION_MS);
    return token;
  }

  private check(password: string, salt: string, hash: string): boolean {
    const next = scryptSync(password, salt, 32);
    const prev = Buffer.from(hash, 'hex');
    if (next.length !== prev.length) return false;
    return timingSafeEqual(next, prev);
  }

  private locked(username: string, now: number): boolean {
    const row = this.fails.get(username.toLowerCase());
    return !!row && row.until > now;
  }

  private fail(username: string, now: number): void {
    const key = username.toLowerCase();
    const row = this.fails.get(key) ?? { n: 0, until: 0 };
    row.n += 1;
    if (row.n >= 8) {
      row.until = now + 10 * 60 * 1000;
      row.n = 0;
    }
    this.fails.set(key, row);
  }
}

function toProfile(row: UserRow): Profile {
  const xp = row.xp;
  return {
    username: row.username,
    xp,
    level: levelForXp(xp),
    matches: row.matches,
    wins: row.wins,
    losses: row.losses,
    kills: row.kills,
    deaths: row.deaths,
    damageDealt: row.damage_dealt,
    damageTaken: row.damage_taken,
    playSeconds: row.play_seconds,
    bestStreak: row.best_streak,
    streak: row.streak,
    kothPoints: row.koth_points,
    infectionWins: row.infection_wins,
    duelWins: row.duel_wins,
    loadout: { color: row.color, hat: row.hat, face: row.face },
  };
}

/**
 * Env-configured login for the OWNER_USERNAME account (its stored password is random).
 * This only signs Roman into his normal profile; it grants nothing extra.
 */
export function ownerPasswordMatches(username: unknown, password: unknown): boolean {
  const expected = process.env.OWNER_USERNAME;
  if (!expected || typeof username !== 'string' || username !== expected) return false;
  if (typeof password !== 'string') return false;
  const stored = process.env.OWNER_PASSWORD_HASH;
  if (!stored) return false;
  const [kind, salt, hash] = stored.split('$');
  if (kind !== 'scrypt' || !salt || !hash) return false;
  const next = scryptSync(password, salt, 32);
  const prev = Buffer.from(hash, 'hex');
  if (next.length !== prev.length) return false;
  return timingSafeEqual(next, prev);
}
