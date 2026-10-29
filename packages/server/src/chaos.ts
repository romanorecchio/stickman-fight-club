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
  private readonly stamps = new Map<string, number[]>();
  private active: Active[] = [];
  private rng = Math.random;

  constructor(private readonly accounts: Accounts | null) {}

  /** Catalog for the panel. Open to every player: there is no owner gate. */
  catalog(): { effects: ChaosEffectDef[] } {
    return { effects: CHAOS_EFFECTS };
  }

  /** Any player in the room may cast. `actor` is the caster's player id. */
  cast(actor: string, raw: unknown, roster: string[], now = Date.now()): { ok: true; effect: string } | { error: string } {
    if (!this.allow(actor, now)) return { error: 'Slow down.' };
    const body = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
    const effect = typeof body.effect === 'string' ? body.effect.slice(0, 40) : '';
    if (effect === 'roulette') return this.roll(actor, body, roster, now);
    if (effect === 'reset') return this.reset(actor);
    return this.fire(actor, effect, body, roster, now);
  }

  reset(actor: string): { ok: true; effect: string } {
    this.active = [];
    this.accounts?.audit(actor, 'reset', 'all');
    return { ok: true, effect: 'reset' };
  }

  private fire(actor: string, effect: string, body: Record<string, unknown>, roster: string[], now: number): { ok: true; effect: string } | { error: string } {
    const def = CHAOS_EFFECTS.find((item) => item.id === effect);
    if (!def || effect === 'roulette') return { error: 'Unknown effect.' };
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
    if (this.active.length >= 64) this.active.shift();
    this.active.push({ effect, targets, until: now + duration * 1000, intensity, image, fired: false, next: now });
    this.accounts?.audit(actor, effect, targets.join(',').slice(0, 180));
    return { ok: true, effect };
  }

  dismiss(playerId: string): void {
    this.active = this.active.filter((item) => !(JUMPSCARES.has(item.effect) && item.targets.includes(playerId)));
  }

  dropPlayer(playerId: string): void {
    this.stamps.delete(playerId);
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

  private roll(actor: string, body: Record<string, unknown>, roster: string[], now: number): { ok: true; effect: string } | { error: string } {
    const safe = CHAOS_EFFECTS.filter((item) => item.id !== 'roulette' && item.id !== 'custom');
    const pick = safe[Math.floor(this.rng() * safe.length)];
    if (!pick) return { error: 'Nothing to roll.' };
    return this.fire(actor, pick.id, body, roster, now);
  }

  /** At most 8 casts per player per 10 s. */
  private allow(actor: string, now: number): boolean {
    const recent = (this.stamps.get(actor) ?? []).filter((stamp) => now - stamp < 10_000);
    if (recent.length >= 8) {
      this.stamps.set(actor, recent);
      return false;
    }
    recent.push(now);
    this.stamps.set(actor, recent);
    return true;
  }

  private targets(raw: unknown, roster: string[]): string[] {
    if (raw === 'all') return [...roster];
    if (!Array.isArray(raw)) return [];
    const ids = raw.filter((id): id is string => typeof id === 'string' && roster.includes(id));
    return [...new Set(ids)].slice(0, 8);
  }
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
