import { knockDown, launch as launchBody } from './knock.js';
import {
  rollWeapon,
  weaponById,
  type WeaponCategories,
  type WeaponClass,
  type WeaponDef,
} from '@sfc/shared';
import type { EffectSpawn } from './combat.js';
import type { Fighter } from './fighter.js';
import type { LiveSolid } from './level.js';

export interface Pickup {
  id: number;
  weapon: string;
  x: number;
  y: number;
}

export interface Bolt {
  id: number;
  weapon: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  fuse: number;
  owner: string;
  radius: number;
  damage: number;
  knock: number;
  slip: boolean;
  sticky: boolean;
  mine: boolean;
  stuckTo: string | null;
  ox: number;
  oy: number;
  armed: number;
  bounces: number;
  chain: number;
}

export interface SlipZone {
  x: number;
  y: number;
  r: number;
  until: number;
}

export interface SolidBox {
  x: number;
  y: number;
  hx: number;
  hy: number;
  live: LiveSolid | null;
}

export interface ArsenalState {
  enabled: boolean;
  categories: WeaponCategories;
  allow: WeaponClass[] | null;
  pickups: Pickup[];
  bolts: Bolt[];
  zones: SlipZone[];
  nextId: number;
  scatterIn: number;
  points: { x: number; y: number }[];
}

export interface ArsenalHost {
  time: number;
  gravity: number;
  rng: () => number;
  fighters: Fighter[];
  boxes: SolidBox[];
  friendlyFire: boolean;
  teams: Map<string, string>;
  effect: (effect: EffectSpawn) => void;
  destroySolid: (solid: LiveSolid) => void;
}

const HIT_CAP = 48;

export function freshArsenal(): ArsenalState {
  return {
    enabled: false,
    categories: { melee: true, firearm: true, explosive: true, novelty: true },
    allow: null,
    pickups: [],
    bolts: [],
    zones: [],
    nextId: 1,
    scatterIn: 8,
    points: [],
  };
}

export function deployArsenal(
  state: ArsenalState,
  enabled: boolean,
  categories: WeaponCategories,
  allow: WeaponClass[] | null,
  points: { x: number; y: number }[],
  rng: () => number,
): void {
  state.enabled = enabled;
  state.categories = { ...categories };
  state.allow = allow;
  state.pickups = [];
  state.bolts = [];
  state.zones = [];
  state.points = points;
  state.scatterIn = 8;
  if (enabled) scatter(state, rng, Math.min(6, Math.max(3, points.length)));
}

export function giveWeapon(fighter: Fighter, id: string): void {
  const def = weaponById(id);
  if (!def) return;
  fighter.weaponId = def.id;
  fighter.ammo = def.mag;
  fighter.reserve = def.reserve;
  fighter.fireCd = 0;
  fighter.reloadLeft = 0;
}

export function tickArsenal(state: ArsenalState, host: ArsenalHost, dt: number, inputs: ReadonlyMap<string, { punch: boolean; reload?: boolean; pickup?: boolean; drop?: boolean; aimX: number; aimY: number }>): void {
  for (const fighter of host.fighters) {
    fighter.fireCd = Math.max(0, fighter.fireCd - dt);
    if (fighter.reloadLeft > 0) {
      fighter.reloadLeft = Math.max(0, fighter.reloadLeft - dt);
      if (fighter.reloadLeft === 0) finishReload(fighter);
    }
    fighter.slipLeft = Math.max(0, fighter.slipLeft - dt);
  }
  for (const zone of state.zones) {
    for (const fighter of host.fighters) {
      const p = fighter.bodies.torso.getPosition();
      if (Math.hypot(p.x - zone.x, p.y - zone.y) < zone.r) fighter.slipLeft = Math.max(fighter.slipLeft, 0.2);
    }
  }
  state.zones = state.zones.filter((zone) => zone.until > host.time);

  if (state.enabled) {
    state.scatterIn -= dt;
    if (state.scatterIn <= 0 && state.pickups.length < 4) {
      scatter(state, host.rng, 2);
      state.scatterIn = 8;
    }
  }

  for (const fighter of host.fighters) {
    const input = inputs.get(fighter.id);
    if (!input || fighter.state === 'ko') continue;
    if (input.pickup) takePickup(state, fighter);
    if (input.drop) dropWeapon(state, fighter);
    const def = weaponById(fighter.weaponId);
    if (!def) continue;
    if (input.reload) startReload(fighter, def);
    if (def.kind === 'pull') pull(fighter, def, host, input.punch);
    else if (input.punch) fire(state, fighter, def, host);
  }

  stepBolts(state, host, dt);
}

/** Guns and thrown explosives should not also swing a fist. */
export function suppressLimb(fighter: Fighter): boolean {
  const def = weaponById(fighter.weaponId);
  return !!def && def.kind !== 'swing';
}

function scatter(state: ArsenalState, rng: () => number, count: number): void {
  const open = state.points.filter((point) => state.pickups.every((pickup) => Math.hypot(pickup.x - point.x, pickup.y - point.y) > 0.8));
  for (let i = 0; i < count && open.length > 0; i += 1) {
    const index = Math.floor(rng() * open.length);
    const point = open.splice(index, 1)[0];
    if (!point) break;
    const weapon = rollWeapon(rng, state.categories, state.allow);
    state.pickups.push({ id: state.nextId++, weapon: weapon.id, x: point.x, y: point.y });
  }
}

function takePickup(state: ArsenalState, fighter: Fighter): void {
  const p = fighter.bodies.torso.getPosition();
  let best: Pickup | null = null;
  let bestDist = 1.2;
  for (const pickup of state.pickups) {
    const dist = Math.hypot(pickup.x - p.x, pickup.y - p.y);
    if (dist < bestDist) {
      best = pickup;
      bestDist = dist;
    }
  }
  if (!best) return;
  if (fighter.weaponId) dropWeapon(state, fighter);
  giveWeapon(fighter, best.weapon);
  state.pickups = state.pickups.filter((pickup) => pickup !== best);
}

function dropWeapon(state: ArsenalState, fighter: Fighter): void {
  if (!fighter.weaponId) return;
  const p = fighter.bodies.torso.getPosition();
  state.pickups.push({
    id: state.nextId++,
    weapon: fighter.weaponId,
    x: p.x + fighter.facing * 0.45,
    y: Math.max(0.4, p.y - 0.2),
  });
  fighter.weaponId = null;
  fighter.ammo = 0;
  fighter.reserve = 0;
  fighter.reloadLeft = 0;
}

function startReload(fighter: Fighter, def: WeaponDef): void {
  if (def.mag <= 0 || fighter.reloadLeft > 0 || fighter.ammo >= def.mag || fighter.reserve <= 0) return;
  fighter.reloadLeft = def.reload;
}

function finishReload(fighter: Fighter): void {
  const def = weaponById(fighter.weaponId);
  if (!def || def.mag <= 0) return;
  const need = def.mag - fighter.ammo;
  const take = Math.min(need, fighter.reserve);
  fighter.ammo += take;
  fighter.reserve -= take;
}

function fire(state: ArsenalState, fighter: Fighter, def: WeaponDef, host: ArsenalHost): void {
  if (fighter.fireCd > 0 || fighter.reloadLeft > 0) return;
  if (def.kind === 'swing') {
    swing(fighter, def, host);
    fighter.fireCd = def.cooldown;
    return;
  }
  if ((def.kind === 'hitscan' || def.kind === 'projectile' || def.kind === 'place') && def.mag > 0 && fighter.ammo <= 0) {
    startReload(fighter, def);
    return;
  }
  if (def.kind === 'hitscan') {
    for (let pellet = 0; pellet < def.pellets; pellet += 1) hitscan(fighter, def, host);
    fighter.ammo = Math.max(0, fighter.ammo - 1);
    fighter.fireCd = 1 / Math.max(0.2, def.rate);
    recoil(fighter, def.knockback * 8);
    return;
  }
  if (def.kind === 'place') {
    layMine(state, fighter, def);
    fighter.ammo = Math.max(0, fighter.ammo - 1);
    fighter.fireCd = def.cooldown;
    return;
  }
  if (def.kind === 'projectile') {
    launch(state, fighter, def);
    fighter.ammo = Math.max(0, fighter.ammo - 1);
    fighter.fireCd = def.cooldown;
    recoil(fighter, 4);
  }
}

function swing(fighter: Fighter, def: WeaponDef, host: ArsenalHost): void {
  const origin = fighter.bodies.handF.getPosition();
  const aim = aimOf(fighter);
  for (const other of host.fighters) {
    if (other === fighter) continue;
    const p = other.bodies.torso.getPosition();
    const dx = p.x - origin.x;
    const dy = p.y - origin.y;
    const dist = Math.hypot(dx, dy);
    if (dist > def.reach || dist < 0.01) continue;
    if ((dx * aim.x + dy * aim.y) / dist < 0.2) continue;
    const scaled = def.damage * (fighter.infected ? 1.35 : 1);
    hurt(host, fighter, other, scaled, def.knockback, origin.x, origin.y);
    if (def.slip) other.slipLeft = Math.max(other.slipLeft, 1.4);
  }
  if (def.breaks) blastSolids(host, origin.x, origin.y, def.reach, 22, 0);
  host.effect({ kind: 'hit', x: origin.x + aim.x * 0.4, y: origin.y + aim.y * 0.4, mag: 0.6, text: '' });
}

function hitscan(fighter: Fighter, def: WeaponDef, host: ArsenalHost): void {
  const origin = fighter.bodies.torso.getPosition();
  const aim = aimOf(fighter);
  const angle = Math.atan2(aim.y, aim.x) + (host.rng() - 0.5) * def.spread;
  const dir = { x: Math.cos(angle), y: Math.sin(angle) };
  let best: Fighter | null = null;
  let bestT = def.range;
  for (const other of host.fighters) {
    if (other === fighter || other.state === 'ko') continue;
    const p = other.bodies.torso.getPosition();
    const dx = p.x - origin.x;
    const dy = p.y - origin.y;
    const t = dx * dir.x + dy * dir.y;
    if (t < 0.25 || t >= bestT) continue;
    const miss = Math.hypot(dx - dir.x * t, dy - dir.y * t);
    if (miss > 0.42) continue;
    best = other;
    bestT = t;
  }
  for (const box of host.boxes) {
    const t = rayBox(origin.x, origin.y, dir.x, dir.y, box);
    if (t !== null && t < bestT) best = null;
    if (t !== null && t < bestT) bestT = t;
  }
  host.effect({ kind: 'hit', x: origin.x + dir.x * Math.min(bestT, 1.2), y: origin.y + dir.y * 0.2, mag: 0.4, text: '' });
  const victim = fighter.chaosBackfire && best ? fighter : best;
  if (victim) {
    const scaled = def.damage * (fighter.infected ? 0.55 : 1);
    hurt(host, fighter, victim, scaled, def.knockback, victim.bodies.torso.getPosition().x, victim.bodies.torso.getPosition().y);
  }
}

function launch(state: ArsenalState, fighter: Fighter, def: WeaponDef): void {
  const origin = fighter.bodies.handF.getPosition();
  const aim = aimOf(fighter);
  const angle = Math.atan2(aim.y, aim.x);
  state.bolts.push({
    id: state.nextId++,
    weapon: def.id,
    x: origin.x + Math.cos(angle) * 0.35,
    y: origin.y + Math.sin(angle) * 0.35,
    vx: Math.cos(angle) * def.speed,
    vy: Math.sin(angle) * def.speed,
    fuse: def.fuse,
    owner: fighter.id,
    radius: def.radius,
    damage: def.damage,
    knock: def.knockback,
    slip: def.slip,
    sticky: def.sticky,
    mine: false,
    stuckTo: null,
    ox: 0,
    oy: 0,
    armed: 0,
    bounces: def.id === 'rocket' || def.id === 'chicken' || def.slip ? 0 : 3,
    chain: 0,
  });
}

function layMine(state: ArsenalState, fighter: Fighter, def: WeaponDef): void {
  const p = fighter.bodies.torso.getPosition();
  state.bolts.push({
    id: state.nextId++,
    weapon: def.id,
    x: p.x,
    y: 0.12,
    vx: 0,
    vy: 0,
    fuse: 30,
    owner: fighter.id,
    radius: def.radius,
    damage: def.damage,
    knock: def.knockback,
    slip: false,
    sticky: false,
    mine: true,
    stuckTo: null,
    ox: 0,
    oy: 0,
    armed: 0.45,
    bounces: 0,
    chain: 0,
  });
}

function pull(fighter: Fighter, def: WeaponDef, host: ArsenalHost, held: boolean): void {
  const origin = fighter.bodies.handF.getPosition();
  const aim = aimOf(fighter);
  let best: Fighter | null = null;
  let bestDist = def.reach;
  for (const other of host.fighters) {
    if (other === fighter) continue;
    const p = other.bodies.torso.getPosition();
    const dist = Math.hypot(p.x - origin.x, p.y - origin.y);
    if (dist < bestDist) {
      best = other;
      bestDist = dist;
    }
  }
  if (!best) return;
  const torso = best.bodies.torso;
  const p = torso.getPosition();
  if (held) {
    const tx = origin.x + aim.x * 1.15;
    const ty = origin.y + aim.y * 1.15;
    const fx = Math.max(-70, Math.min(70, (tx - p.x) * 28));
    const fy = Math.max(-70, Math.min(70, (ty - p.y) * 28));
    torso.applyForce({ x: fx, y: fy }, torso.getWorldCenter(), true);
    fighter.pulling = best.id;
  } else if (fighter.pulling === best.id) {
    hurt(host, fighter, best, def.damage, def.knockback, p.x, p.y);
    fighter.pulling = null;
    fighter.fireCd = 0.35;
  }
}

function stepBolts(state: ArsenalState, host: ArsenalHost, dt: number): void {
  const pending: Bolt[] = [];
  for (const bolt of state.bolts) {
    if (bolt.stuckTo) {
      const hostFighter = host.fighters.find((fighter) => fighter.id === bolt.stuckTo);
      if (!hostFighter) {
        pending.push(bolt);
        continue;
      }
      const p = hostFighter.bodies.torso.getPosition();
      bolt.x = p.x + bolt.ox;
      bolt.y = p.y + bolt.oy;
    } else if (!bolt.mine) {
      bolt.vy += host.gravity * dt;
      bolt.x += bolt.vx * dt;
      bolt.y += bolt.vy * dt;
    }
    bolt.fuse -= dt;
    bolt.armed = Math.max(0, bolt.armed - dt);
    let boom = bolt.fuse <= 0;
    if (bolt.mine && bolt.armed <= 0) {
      for (const fighter of host.fighters) {
        if (fighter.id === bolt.owner) continue;
        const p = fighter.bodies.torso.getPosition();
        if (Math.abs(p.x - bolt.x) < 0.7 && p.y > bolt.y - 0.3 && p.y < bolt.y + 1.8) boom = true;
      }
    }
    if (!boom && !bolt.mine && !bolt.stuckTo) {
      for (const box of host.boxes) {
        if (!overlaps(bolt.x, bolt.y, 0.12, box)) continue;
        if (bolt.bounces > 0) {
          const dx = bolt.x - box.x;
          const dy = bolt.y - box.y;
          if (Math.abs(dx) / box.hx > Math.abs(dy) / box.hy) bolt.vx *= -0.55;
          else bolt.vy *= -0.45;
          bolt.bounces -= 1;
          bolt.x += Math.sign(dx || 1) * 0.05;
          bolt.y += Math.sign(dy || 1) * 0.05;
        } else boom = true;
        break;
      }
      if (!boom && bolt.sticky) {
        for (const fighter of host.fighters) {
          const p = fighter.bodies.torso.getPosition();
          if (Math.hypot(p.x - bolt.x, p.y - bolt.y) < 0.55) {
            bolt.stuckTo = fighter.id;
            bolt.ox = bolt.x - p.x;
            bolt.oy = bolt.y - p.y;
            bolt.vx = 0;
            bolt.vy = 0;
            break;
          }
        }
      } else if (!boom && bolt.bounces === 0) {
        for (const fighter of host.fighters) {
          if (fighter.id === bolt.owner) continue;
          const p = fighter.bodies.torso.getPosition();
          if (Math.hypot(p.x - bolt.x, p.y - bolt.y) < 0.48) boom = true;
        }
      }
    }
    if (boom) pending.push(bolt);
  }
  if (pending.length === 0) return;
  const doomed = new Set(pending);
  state.bolts = state.bolts.filter((bolt) => !doomed.has(bolt));
  for (const bolt of pending) explode(state, host, bolt);
}

function explode(state: ArsenalState, host: ArsenalHost, bolt: Bolt): void {
  const owner = host.fighters.find((fighter) => fighter.id === bolt.owner) ?? null;
  for (const fighter of host.fighters) {
    const p = fighter.bodies.torso.getPosition();
    const dist = Math.hypot(p.x - bolt.x, p.y - bolt.y);
    if (dist > bolt.radius) continue;
    const falloff = 1 - dist / bolt.radius;
    if (owner) hurt(host, owner, fighter, bolt.damage * falloff, bolt.knock * falloff, p.x, p.y);
    else applyRaw(fighter, bolt.damage * falloff, (p.x - bolt.x) / (dist || 1), (p.y - bolt.y) / (dist || 1), bolt.knock * falloff);
    if (bolt.slip) fighter.slipLeft = Math.max(fighter.slipLeft, 1.6);
  }
  if (bolt.slip) state.zones.push({ x: bolt.x, y: bolt.y, r: bolt.radius, until: host.time + 3 });
  host.effect({ kind: 'boom', x: bolt.x, y: bolt.y, mag: bolt.radius, text: '' });
  const chained = blastSolids(host, bolt.x, bolt.y, bolt.radius, 40, bolt.chain);
  for (const solid of chained) {
    explode(state, host, {
      ...bolt,
      id: state.nextId++,
      x: solid.x,
      y: solid.y,
      owner: '',
      chain: bolt.chain + 1,
      sticky: false,
      mine: false,
      stuckTo: null,
      bounces: 0,
      slip: false,
      damage: Math.max(18, bolt.damage * 0.7),
      radius: Math.max(1.4, bolt.radius * 0.8),
    });
  }
}

function blastSolids(host: ArsenalHost, x: number, y: number, radius: number, amount: number, chain: number): LiveSolid[] {
  if (chain >= 3) return [];
  const popped: LiveSolid[] = [];
  for (const box of host.boxes) {
    if (!box.live || box.live.dead || box.live.hp === null) continue;
    if (!overlaps(x, y, radius, box)) continue;
    box.live.hp -= amount;
    if (box.live.hp <= 0) {
      const barrel = box.live.barrel;
      host.destroySolid(box.live);
      if (barrel) popped.push(box.live);
    }
  }
  return popped;
}

function hurt(host: ArsenalHost, attacker: Fighter, victim: Fighter, damage: number, knock: number, x: number, y: number): void {
  if (attacker !== victim && !host.friendlyFire) {
    const ta = host.teams.get(attacker.id);
    const tb = host.teams.get(victim.id);
    if (ta && ta === tb) return;
  }
  if (victim.spawnProtect > 0 || victim.state === 'ko') return;
  const before = victim.hp;
  const origin = attacker.bodies.torso.getPosition();
  const p = victim.bodies.torso.getPosition();
  let dx = p.x - origin.x;
  let dy = 0.35 + (p.y - origin.y) * 0.15;
  const n = Math.hypot(dx, dy) || 1;
  dx /= n;
  dy /= n;
  applyRaw(victim, damage * (attacker.chaosNoodle ? 0.15 : 1), dx, dy, knock);
  attacker.dealt += Math.max(0, before - victim.hp);
  victim.lastHurtBy = attacker.id;
  host.effect({ kind: 'text', x, y: y + 0.25, mag: damage, text: String(Math.round(Math.min(HIT_CAP, damage))) });
}

function applyRaw(victim: Fighter, damage: number, dx: number, dy: number, knock: number): void {
  const amount = Math.max(0, Math.min(HIT_CAP, damage));
  if (amount < 0.4) return;
  const shield = weaponById(victim.weaponId);
  const blocked = victim.blocking || shield?.id === 'shield';
  const dealt = blocked ? amount * (shield?.id === 'shield' ? 0.35 : 0.55) : amount;
  victim.hp = Math.max(0, victim.hp - dealt);
  victim.taken += dealt;
  const impulse = Math.min(26, 10 + knock * 8) * (blocked ? 0.45 : 1);
  // Whole-body launch (see knock.ts) so weapon hits send people cartwheeling without stretching joints.
  const dv = impulse * 0.28;
  launchBody(victim, dx * dv, Math.max(0.25, dy) * dv * 0.9, -Math.sign(dx || 1) * dv * 0.55);
  victim.flash = 0.12;
  victim.balanceMute = Math.max(victim.balanceMute, knock > 1.4 ? 0.35 : 0.12);
  if (victim.hp <= 0) {
    victim.hp = 0;
    victim.state = 'ko';
    victim.stateTime = 0;
    victim.attack = null;
    victim.strike = null;
  } else if (knock > 1.5 && !blocked) {
    knockDown(victim, 0.5 + knock * 0.3);
  } else {
    victim.hitStun = Math.max(victim.hitStun, 0.12);
  }
}

function recoil(fighter: Fighter, mag: number): void {
  const aim = aimOf(fighter);
  fighter.bodies.torso.applyLinearImpulse({ x: -aim.x * mag, y: -aim.y * mag * 0.2 }, fighter.bodies.torso.getWorldCenter(), true);
}

function aimOf(fighter: Fighter): { x: number; y: number } {
  const len = Math.hypot(fighter.lastInput.aimX, fighter.lastInput.aimY) || 1;
  return { x: fighter.lastInput.aimX / len, y: fighter.lastInput.aimY / len };
}

function overlaps(x: number, y: number, radius: number, box: SolidBox): boolean {
  const dx = Math.max(Math.abs(x - box.x) - box.hx, 0);
  const dy = Math.max(Math.abs(y - box.y) - box.hy, 0);
  return dx * dx + dy * dy <= radius * radius;
}

function rayBox(ox: number, oy: number, dx: number, dy: number, box: SolidBox): number | null {
  const minX = box.x - box.hx;
  const maxX = box.x + box.hx;
  const minY = box.y - box.hy;
  const maxY = box.y + box.hy;
  const invX = 1 / (dx || 1e-8);
  const invY = 1 / (dy || 1e-8);
  let t1 = (minX - ox) * invX;
  let t2 = (maxX - ox) * invX;
  let t3 = (minY - oy) * invY;
  let t4 = (maxY - oy) * invY;
  const tmin = Math.max(Math.min(t1, t2), Math.min(t3, t4));
  const tmax = Math.min(Math.max(t1, t2), Math.max(t3, t4));
  if (tmax < 0 || tmin > tmax) return null;
  const t = tmin >= 0 ? tmin : tmax;
  return t >= 0 ? t : null;
}

export function hazardTick(host: ArsenalHost, hazards: { kind: string; x: number; y: number; hx: number; hy: number; dps: number; force: number }[], dt: number): void {
  for (const fighter of host.fighters) {
    const p = fighter.bodies.torso.getPosition();
    for (const hazard of hazards) {
      if (Math.abs(p.x - hazard.x) > hazard.hx || Math.abs(p.y - hazard.y) > hazard.hy) continue;
      if (hazard.kind === 'lava' && hazard.dps > 0 && fighter.state !== 'ko') {
        fighter.hp = Math.max(0, fighter.hp - hazard.dps * dt);
        fighter.flash = 0.08;
        if (fighter.hp <= 0) {
          fighter.hp = 0;
          fighter.state = 'ko';
          fighter.stateTime = 0;
        }
      }
      if (hazard.kind === 'conveyor' && hazard.force !== 0) {
        fighter.bodies.torso.applyForce({ x: hazard.force, y: 0 }, fighter.bodies.torso.getWorldCenter(), true);
      }
    }
  }
}
