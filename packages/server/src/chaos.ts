import { scryptSync, timingSafeEqual } from 'node:crypto';
import type { PrivateFx } from '@sfc/shared';
import type { Accounts } from './accounts.js';
import type { Simulation } from '@sfc/sim';

export interface ChaosEffectDef {
  id: string;
  name: string;
  tab: 'jumpscares' | 'physics' | 'visuals' | 'controls' | 'weapons' | 'roulette';
}

export const CHAOS_EFFECTS: ChaosEffectDef[] = [
  { id: 'nightmare', name: 'Nightmare Face', tab: 'jumpscares' },
  { id: 'goofy', name: 'Goofy Screamer', tab: 'jumpscares' },
  { id: 'crash', name: 'Fake Crash Jumpscare', tab: 'jumpscares' },
  { id: 'custom', name: 'Custom Jumpscare', tab: 'jumpscares' },
  { id: 'victory', name: 'Fake Victory', tab: 'visuals' },
  { id: 'disconnect', name: 'Fake Disconnect', tab: 'visuals' },
  { id: 'legendary', name: 'Fake Legendary Weapon', tab: 'visuals' },
  { id: 'update', name: 'Fake Game Update', tab: 'visuals' },
  { id: 'killcam', name: 'Fake Killcam', tab: 'visuals' },
  { id: 'champion', name: 'Fake Champion', tab: 'visuals' },
  { id: 'yeet', name: 'YEET', tab: 'physics' },
  { id: 'spaghetti', name: 'Spaghetti Bones', tab: 'physics' },
  { id: 'zero-gravity', name: 'Zero Gravity', tab: 'physics' },
  { id: 'heavy', name: 'Heavyweight', tab: 'physics' },
  { id: 'pinball', name: 'Human Pinball', tab: 'physics' },
  { id: 'tiny', name: 'Tiny Stickman', tab: 'physics' },
  { id: 'giant-head', name: 'Giant Head', tab: 'physics' },
  { id: 'reverse-gravity', name: 'Reverse Gravity', tab: 'physics' },
  { id: 'slippery', name: 'Slippery Feet', tab: 'physics' },
  { id: 'trampoline', name: 'Invisible Trampoline', tab: 'physics' },
  { id: 'reverse-controls', name: 'Reverse Controls', tab: 'controls' },
  { id: 'upside-down', name: 'Upside-Down Screen', tab: 'controls' },
  { id: 'mirror', name: 'Mirror World', tab: 'controls' },
  { id: 'teleport', name: 'Random Teleport', tab: 'controls' },
  { id: 'invisible', name: 'Invisible Man', tab: 'controls' },
  { id: 'chicken', name: 'Chicken Gun', tab: 'weapons' },
  { id: 'roulette-weapon', name: 'Weapon Roulette', tab: 'weapons' },
  { id: 'backfire', name: 'Backfire', tab: 'weapons' },
  { id: 'noodle', name: 'Pool Noodle', tab: 'weapons' },
  { id: 'roulette', name: 'Chaos Roulette', tab: 'roulette' },
];

const JUMPSCARES = new Set(['nightmare', 'goofy', 'crash', 'custom']);
const GRAVITY = new Set(['zero-gravity', 'reverse-gravity']);
const BANNERS: Record<string, string> = {
  victory: 'YOU WIN',
  disconnect: 'OPPONENT DISCONNECTED',
  legendary: 'LEGENDARY DROP',
  update: 'UPDATE COMPLETE',
  killcam: 'KILLCAM',
  champion: 'NEW CHAMPION',
};

export interface ChaosBody {
  id: string;
  hp: number;
  x: number;
  y: number;
  jumpscares: boolean;
  reduceMotion: boolean;
  reduceFlash: boolean;
}

interface Active {
  effect: string;
  targets: string[];
  until: number;
  intensity: number;
  image: string | null;
  fired: boolean;
  next: number;
}

const EMPTY_FX: PrivateFx = {
  jumpscare: null,
  customImage: null,
  banner: null,
  flipScreen: false,
  mirror: false,
  reduceMotion: false,
  reduceFlash: false,
};

export class ChaosControl {
  private readonly owners = new Map<string, number>();
  private readonly unlocked = new Map<string, number>();
  private readonly fails = new Map<string, { n: number; until: number }>();
  private readonly stamps: number[] = [];
  private active: Active[] = [];
  private rng = Math.random;

  constructor(private readonly accounts: Accounts | null) {}

  noteOwner(token: string, now = Date.now()): void {
    this.owners.set(token, now + 30 * 60 * 1000);
  }

  isOwner(token: unknown, now = Date.now()): boolean {
    if (typeof token !== 'string') return false;
    const until = this.owners.get(token) ?? 0;
    if (until < now) {
      this.owners.delete(token);
      this.unlocked.delete(token);
      return false;
    }
    return true;
  }

  /** Catalog for the lazy panel. Null when the caller is not the owner. */
  begin(token: unknown, now = Date.now()): { effects: ChaosEffectDef[] } | null {
    if (!this.isOwner(token, now)) return null;
    this.accounts?.audit('owner', 'gate', 'open');
    return { effects: CHAOS_EFFECTS };
  }

  submitCode(token: unknown, code: unknown, now = Date.now()): { ok: true } | { error: string } | null {
    if (!this.isOwner(token, now) || typeof token !== 'string') return null;
    const fail = this.fails.get(token) ?? { n: 0, until: 0 };
    if (fail.until > now) {
      this.accounts?.audit('owner', 'lockout', 'code');
      return { error: 'Locked. Wait and try again.' };
    }
    if (typeof code !== 'string' || !verifyHash(code, process.env.OWNER_CHAOS_CODE_HASH)) {
      fail.n += 1;
      if (fail.n >= 5) {
        fail.until = now + 10 * 60 * 1000;
        fail.n = 0;
      }
      this.fails.set(token, fail);
      this.accounts?.audit('owner', 'bad-code', 'refused');
      return { error: 'That code was refused.' };
    }
    this.fails.delete(token);
    this.unlocked.set(token, now + 20 * 60 * 1000);
    this.accounts?.audit('owner', 'unlock', 'ok');
    return { ok: true };
  }

  cast(token: unknown, raw: unknown, roster: string[], now = Date.now()): { ok: true } | { error: string } | null {
    if (!this.live(token, now) || typeof token !== 'string') return null;
    if (!this.allow(now)) return { error: 'Slow down.' };
    const body = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
    const effect = typeof body.effect === 'string' ? body.effect : '';
    if (effect === 'roulette') return this.roll(token, body, roster, now);
    if (effect === 'reset') return this.reset(token, now);
    const def = CHAOS_EFFECTS.find((item) => item.id === effect);
    if (!def) return { error: 'Unknown effect.' };
    const targets = this.targets(body.targets, roster);
    if (targets.length === 0) return { error: 'Pick someone in this lobby.' };
    const duration = clampNum(body.duration, 1, 15, 4);
    const intensity = clampNum(body.intensity, 10, 100, 70) / 100;
    let image: string | null = null;
    if (effect === 'custom') {
      image = sanitizeImage(body.image);
      if (!image) return { error: 'Custom jumpscares must be a PNG or JPEG under 400 KB.' };
    }
    if (GRAVITY.has(effect)) this.active = this.active.filter((item) => !GRAVITY.has(item.effect));
    this.active.push({ effect, targets, until: now + duration * 1000, intensity, image, fired: false, next: now });
    this.accounts?.audit('owner', effect, targets.join(',').slice(0, 180));
    return { ok: true };
  }

  reset(token: unknown, now = Date.now()): { ok: true } | null {
    if (!this.live(token, now)) return null;
    this.active = [];
    this.accounts?.audit('owner', 'reset', 'all');
    return { ok: true };
  }

  dismiss(playerId: string): void {
    this.active = this.active.filter((item) => !(JUMPSCARES.has(item.effect) && item.targets.includes(playerId)));
  }

  dropPlayer(playerId: string): void {
    for (const item of this.active) item.targets = item.targets.filter((id) => id !== playerId);
    this.active = this.active.filter((item) => item.targets.length > 0);
  }

  clearRound(): void {
    this.active = [];
  }

  apply(sim: Simulation, bodies: ChaosBody[], now: number): Map<string, PrivateFx> {
    this.active = this.active.filter((item) => item.until > now);
    const dead = new Set(bodies.filter((body) => body.hp <= 0).map((body) => body.id));
    for (const item of this.active) item.targets = item.targets.filter((id) => !dead.has(id));
    this.active = this.active.filter((item) => item.targets.length > 0);

    let gravity: number | null = null;
    const flags = new Map<string, { invisible: boolean; tiny: boolean; giant: boolean; backfire: boolean; noodle: boolean; flip: boolean; heavy: boolean }>();
    const blank = () => ({ invisible: false, tiny: false, giant: false, backfire: false, noodle: false, flip: false, heavy: false });
    for (const body of bodies) flags.set(body.id, blank());
    const fx = new Map<string, PrivateFx>();
    for (const body of bodies) {
      fx.set(body.id, {
        ...EMPTY_FX,
        reduceMotion: body.reduceMotion,
        reduceFlash: body.reduceFlash,
      });
    }

    for (const item of this.active) {
      if (item.effect === 'zero-gravity') gravity = 0;
      if (item.effect === 'reverse-gravity') gravity = 16 * item.intensity;
      for (const id of item.targets) {
        const flag = flags.get(id) ?? blank();
        const body = bodies.find((entry) => entry.id === id);
        const view = fx.get(id);
        if (item.effect === 'yeet' && !item.fired) {
          const sign = body && body.x > 0 ? -1 : 1;
          sim.debugImpulse(id, sign * 12 * item.intensity, 10 * item.intensity, 1.2 * item.intensity);
        }
        if (item.effect === 'spaghetti' && now >= item.next) {
          sim.debugImpulse(id, (this.rng() - 0.5) * 4 * item.intensity, 2 * item.intensity, (this.rng() - 0.5) * 3 * item.intensity);
          item.next = now + 350;
        }
        if (item.effect === 'pinball' && body && Math.abs(body.x) > 8 && now >= item.next) {
          sim.debugImpulse(id, -Math.sign(body.x) * 10 * item.intensity, 6, 0);
          item.next = now + 400;
        }
        if (item.effect === 'trampoline' && body && body.y < 0.8) {
          sim.debugImpulse(id, 0, 9 * item.intensity, 0);
        }
        if (item.effect === 'slippery') sim.slip(id);
        if (item.effect === 'teleport' && !item.fired) sim.respawnFighter(id);
        if (item.effect === 'heavy') flag.heavy = true;
        if (item.effect === 'tiny') flag.tiny = true;
        if (item.effect === 'giant-head') flag.giant = true;
        if (item.effect === 'invisible') flag.invisible = true;
        if (item.effect === 'reverse-controls') flag.flip = true;
        if (item.effect === 'backfire') flag.backfire = true;
        if (item.effect === 'noodle') flag.noodle = true;
        if (item.effect === 'chicken' && !item.fired) sim.giveWeapon(id, 'chicken');
        if (item.effect === 'roulette-weapon' && now >= item.next) {
          const pool = ['bat', 'pistol', 'grenade', 'fish', 'pan', 'smg'];
          sim.giveWeapon(id, pool[Math.floor(this.rng() * pool.length)] ?? 'bat');
          item.next = now + 1000;
        }
        if (view && BANNERS[item.effect]) view.banner = BANNERS[item.effect] ?? null;
        if (view && item.effect === 'upside-down') view.flipScreen = true;
        if (view && item.effect === 'mirror') view.mirror = true;
        if (view && JUMPSCARES.has(item.effect) && body?.jumpscares !== false) {
          view.jumpscare = item.effect as PrivateFx['jumpscare'];
          if (item.effect === 'custom') view.customImage = item.image;
        }
        flags.set(id, flag);
      }
      item.fired = true;
    }
    sim.setGravityOverride(gravity);
    for (const [id, flag] of flags) sim.setChaosFlags(id, flag);
    return fx;
  }

  private roll(token: string, body: Record<string, unknown>, roster: string[], now: number): { ok: true } | { error: string } {
    const safe = CHAOS_EFFECTS.filter((item) => item.id !== 'roulette' && item.id !== 'custom');
    const pick = safe[Math.floor(this.rng() * safe.length)];
    if (!pick) return { error: 'Nothing to roll.' };
    return this.cast(token, { ...body, effect: pick.id }, roster, now) ?? { error: 'Not unlocked.' };
  }

  private live(token: unknown, now: number): boolean {
    if (!this.isOwner(token, now) || typeof token !== 'string') return false;
    return (this.unlocked.get(token) ?? 0) >= now;
  }

  private allow(now: number): boolean {
    const recent = this.stamps.filter((stamp) => now - stamp < 10_000);
    this.stamps.length = 0;
    this.stamps.push(...recent);
    if (this.stamps.length >= 8) return false;
    this.stamps.push(now);
    return true;
  }

  private targets(raw: unknown, roster: string[]): string[] {
    if (raw === 'all') return [...roster];
    if (!Array.isArray(raw)) return [];
    const ids = raw.filter((id): id is string => typeof id === 'string' && roster.includes(id));
    return [...new Set(ids)].slice(0, 8);
  }
}

export function ownerPasswordMatches(username: unknown, password: unknown): boolean {
  const expected = process.env.OWNER_USERNAME;
  if (!expected || typeof username !== 'string' || username !== expected) return false;
  if (typeof password !== 'string') return false;
  return verifyHash(password, process.env.OWNER_PASSWORD_HASH);
}

function verifyHash(secret: string, stored: string | undefined): boolean {
  if (!stored) return false;
  const [kind, salt, hash] = stored.split('$');
  if (kind !== 'scrypt' || !salt || !hash) return false;
  const next = scryptSync(secret, salt, 32);
  const prev = Buffer.from(hash, 'hex');
  if (next.length !== prev.length) return false;
  return timingSafeEqual(next, prev);
}

function clampNum(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function sanitizeImage(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 560_000) return null;
  const match = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(raw);
  if (!match?.[1] || !match[2]) return null;
  const bytes = Buffer.from(match[2], 'base64');
  if (bytes.length < 16 || bytes.length > 400_000) return null;
  const png = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
  if (match[1] === 'png' && !png) return null;
  if (match[1] === 'jpeg' && !jpeg) return null;
  return `data:image/${match[1]};base64,${match[2]}`;
}
