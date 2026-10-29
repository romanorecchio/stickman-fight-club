import { DistanceJoint, World, type Body } from 'planck';
import { clamp, type BalanceParams, type EffectKind, type FighterId, type PartName } from '@sfc/shared';
import type { Fighter, UserData } from './fighter.js';

export interface QueuedHit {
  a: UserData;
  b: UserData;
  relSpeed: number;
  nx: number;
  ny: number;
  px: number;
  py: number;
}

export interface EffectSpawn {
  kind: EffectKind;
  x: number;
  y: number;
  mag: number;
  text: string;
}

export interface CombatContext {
  params: BalanceParams;
  time: number;
  fighters: Fighter[];
  hitsLanded: { n: number };
  effects: EffectSpawn[];
}

export function attachContacts(world: World, queue: QueuedHit[], ctx: () => CombatContext): void {
  world.on('pre-solve', (contact) => {
    const fa = contact.getFixtureA();
    const fb = contact.getFixtureB();
    const da = fa.getUserData() as UserData | null;
    const db = fb.getUserData() as UserData | null;
    if (!da || !db) return;

    if (isFootOnWorld(da, db)) {
      const foot = da.kind === 'fighter' ? da : db.kind === 'fighter' ? db : null;
      if (foot && foot.kind === 'fighter') {
        const fighter = byId(ctx(), foot.id);
        if (!fighter) return;
        contact.setFriction(footFrictionFor(fighter, ctx().params.footFriction));
      }
    }

    if (!contact.isTouching()) return;
    const manifold = contact.getWorldManifold(null);
    if (!manifold || manifold.pointCount < 1) return;
    const point = manifold.points[0];
    if (!point) return;
    const va = fa.getBody().getLinearVelocityFromWorldPoint(point);
    const vb = fb.getBody().getLinearVelocityFromWorldPoint(point);
    const relSpeed = Math.hypot(va.x - vb.x, va.y - vb.y);
    if (!Number.isFinite(relSpeed) || relSpeed < 2.5) return;
    queue.push({
      a: da,
      b: db,
      relSpeed,
      nx: manifold.normal.x,
      ny: manifold.normal.y,
      px: point.x,
      py: point.y,
    });
  });
}

export function resolveHits(queue: QueuedHit[], ctx: CombatContext): void {
  const seen = new Map<string, QueuedHit>();
  for (const hit of queue) {
    const key = hitKey(hit);
    const prev = seen.get(key);
    if (!prev || hit.relSpeed > prev.relSpeed) seen.set(key, hit);
  }
  for (const hit of seen.values()) applyHit(hit, ctx);
}

export function releaseGrab(world: World, grabber: Fighter, impulse: { x: number; y: number } | null): Fighter | null {
  const grab = grabber.grab;
  if (!grab) return null;
  const victim = grab.victim;
  world.destroyJoint(grab.joint);
  grabber.grab = null;
  if (victim.heldBy === grabber) victim.heldBy = null;
  if (impulse) {
    const torso = victim.bodies.torso;
    torso.applyLinearImpulse(impulse, torso.getWorldCenter(), true);
    torso.applyAngularImpulse(-Math.sign(impulse.x || grabber.facing) * Math.hypot(impulse.x, impulse.y) * 0.06, true);
    victim.balanceMute = Math.max(victim.balanceMute, 0.32);
    victim.hitStun = Math.max(victim.hitStun, 0.22);
    victim.flash = 0.12;
    if (Math.hypot(impulse.x, impulse.y) > 36 && victim.state !== 'ko') {
      victim.state = 'stumble';
    }
  }
  return victim;
}

export function tryAttachGrab(world: World, grabber: Fighter, victim: Fighter): boolean {
  if (grabber.grab || grabber.heldBy || victim.grab || victim.state === 'ko') return false;
  const hand = grabber.bodies.handF.getPosition();
  let best: { part: PartName; dist: number } | null = null;
  for (const part of GRAB_PARTS) {
    const p = victim.bodies[part].getPosition();
    const dist = Math.hypot(hand.x - p.x, hand.y - p.y);
    const limit = part === 'torso' ? 0.5 : part === 'head' ? 0.38 : 0.34;
    if (dist < limit && (!best || dist < best.dist)) best = { part, dist };
  }
  if (!best) return false;
  const other = victim.bodies[best.part];
  const length = Math.max(0.22, best.dist);
  const joint = world.createJoint(
    new DistanceJoint({
      bodyA: grabber.bodies.handF,
      bodyB: other,
      localAnchorA: { x: 0, y: 0 },
      localAnchorB: { x: 0, y: 0 },
      length,
      frequencyHz: 9,
      dampingRatio: 0.8,
      collideConnected: false,
    }),
  );
  if (!joint) return false;
  grabber.grab = { joint, victim, victimPart: best.part, timer: 0, struggle: 0 };
  victim.heldBy = grabber;
  grabber.grabIntent = 0;
  return true;
}

export function updateGrab(world: World, grabber: Fighter, dt: number, params: BalanceParams): boolean {
  const grab = grabber.grab;
  if (!grab) return false;
  const victim = grab.victim;
  const active =
    Math.abs(victim.lastInput.moveX) > 0 || victim.lastInput.jump || victim.lastInput.punch || victim.lastInput.kick;
  grab.timer += dt;
  grab.struggle += dt * params.struggleRate * (active ? 1.65 : 0.55);
  const a = grab.joint.getAnchorA();
  const b = grab.joint.getAnchorB();
  const stretch = Math.hypot(a.x - b.x, a.y - b.y) - grab.joint.getLength();
  if (grab.timer > params.grabDuration || grab.struggle >= 1 || stretch > 0.7 || victim.state === 'ko') {
    releaseGrab(world, grabber, null);
    return true;
  }
  return false;
}

const GRAB_PARTS: PartName[] = [
  'torso',
  'head',
  'upperArmF',
  'upperArmB',
  'lowerArmF',
  'lowerArmB',
  'upperLegF',
  'upperLegB',
];

function applyHit(hit: QueuedHit, ctx: CombatContext): void {
  const aF = hit.a.kind === 'fighter';
  const bF = hit.b.kind === 'fighter';
  if (aF && bF && hit.a.kind === 'fighter' && hit.b.kind === 'fighter') {
    if (hit.a.id === hit.b.id) return;
    resolveFighterHit(hit.a, hit.b, hit, ctx);
    return;
  }
  if (aF !== bF) resolveWorldHit(hit, ctx);
}

function resolveFighterHit(
  a: Extract<UserData, { kind: 'fighter' }>,
  b: Extract<UserData, { kind: 'fighter' }>,
  hit: QueuedHit,
  ctx: CombatContext,
): void {
  const fighterA = byId(ctx, a.id);
  const fighterB = byId(ctx, b.id);
  if (!fighterA || !fighterB) return;
  const strikeA = strikeOf(fighterA, a.part, ctx.time);
  const strikeB = strikeOf(fighterB, b.part, ctx.time);
  let attacker = fighterA;
  let victim = fighterB;
  let part = b.part;
  let strike = strikeA;
  if (strikeB && !strikeA) {
    attacker = fighterB;
    victim = fighterA;
    part = a.part;
    strike = strikeB;
  } else if (strikeA && strikeB) {
    const speedA = limbSpeed(fighterA.bodies[a.part]);
    const speedB = limbSpeed(fighterB.bodies[b.part]);
    if (speedB > speedA) {
      attacker = fighterB;
      victim = fighterA;
      part = a.part;
      strike = strikeB;
    }
  }

  if (!strike) {
    if (hit.relSpeed < 6.5) return;
    bump(fighterA, fighterB, hit, ctx, 0.35);
    bump(fighterB, fighterA, hit, ctx, 0.35);
    return;
  }

  const limb = attacker === fighterA ? fighterA.bodies[a.part] : fighterB.bodies[b.part];
  const power = clamp(limbSpeed(limb) / 10 + 0.55, 0.85, 1.85);
  connect(attacker, victim, part, strike, power, hit, ctx);
}

function connect(
  attacker: Fighter,
  victim: Fighter,
  part: PartName,
  strike: 'punch' | 'kick',
  power: number,
  hit: QueuedHit,
  ctx: CombatContext,
): void {
  attacker.attackHit = true;
  if (victim.spawnProtect > 0 || victim.state === 'ko') {
    ctx.effects.push({ kind: 'block', x: hit.px, y: hit.py, mag: 0.3, text: '' });
    return;
  }
  const ax = attacker.bodies.torso.getPosition().x;
  const vx = victim.bodies.torso.getPosition().x;
  const rel = Math.sign(ax - vx);
  const fromFront = rel === 0 || rel === victim.facing;
  const blocked = victim.blocking && fromFront;
  const loc = part === 'head' ? 1.45 : part === 'torso' ? 1 : 0.62;
  let damage = (strike === 'kick' ? 16 : 12) * power * loc * ctx.params.damageScale;
  if (blocked) damage *= 0.22;
  damage = clamp(damage, 0, 22 * ctx.params.damageScale);

  let kx = vx - ax;
  let ky = 0.28;
  if (Math.abs(kx) < 0.08) kx = attacker.facing;
  const kn = Math.hypot(kx, ky) || 1;
  kx /= kn;
  ky /= kn;
  const base = (strike === 'kick' ? 64 : 44) * power * ctx.params.knockbackScale * (blocked ? 0.25 : 1);
  const torso = victim.bodies.torso;
  torso.applyLinearImpulse({ x: kx * base, y: ky * base }, torso.getWorldCenter(), true);
  torso.applyAngularImpulse(-Math.sign(kx) * base * (strike === 'kick' ? 0.05 : 0.028), true);
  victim.flash = 0.14;
  attacker.flash = 0.06;

  const severity = power * (strike === 'kick' ? 1.22 : 0.84) * (blocked ? 0.28 : 1);
  if (!blocked && severity > 1.2 && victim.state !== 'getup') {
    victim.state = 'fallen';
    victim.stateTime = 0;
    victim.balanceMute = Math.max(victim.balanceMute, 0.42);
    victim.attack = null;
    victim.strike = null;
  } else if (severity > 0.5) {
    victim.hitStun = Math.max(victim.hitStun, blocked ? 0.08 : strike === 'kick' ? 0.28 : 0.2);
    if (!blocked) victim.balanceMute = Math.max(victim.balanceMute, 0.12);
    if (!blocked && victim.state !== 'fallen' && victim.state !== 'getup') {
      victim.state = 'stumble';
    }
  }

  if (damage > 0.4) {
    victim.hp = Math.max(0, victim.hp - damage);
    ctx.hitsLanded.n += 1;
    ctx.effects.push({
      kind: blocked ? 'block' : 'hit',
      x: hit.px,
      y: hit.py,
      mag: power,
      text: '',
    });
    ctx.effects.push({
      kind: 'text',
      x: hit.px,
      y: hit.py + 0.2,
      mag: damage,
      text: blocked ? 'BLOCK' : String(Math.round(damage)),
    });
    if (victim.hp <= 0) {
      victim.hp = 0;
      victim.state = 'ko';
      victim.stateTime = 0;
      victim.attack = null;
      victim.strike = null;
    }
  }
}

function bump(attacker: Fighter, victim: Fighter, hit: QueuedHit, ctx: CombatContext, scale: number): void {
  if (victim.spawnProtect > 0 || victim.envCooldown > 0) return;
  if (victim.state === 'ko' || attacker.state === 'ko') return;
  victim.envCooldown = 0.28;
  const ax = attacker.bodies.torso.getPosition().x;
  const vx = victim.bodies.torso.getPosition().x;
  const sign = Math.abs(vx - ax) < 0.05 ? attacker.facing : Math.sign(vx - ax);
  const mag = clamp((hit.relSpeed - 6) * 1.6, 0, 14) * scale * ctx.params.knockbackScale;
  victim.bodies.torso.applyLinearImpulse({ x: sign * mag, y: mag * 0.15 }, victim.bodies.torso.getWorldCenter(), true);
  victim.hitStun = Math.max(victim.hitStun, 0.1);
  const damage = clamp((hit.relSpeed - 7) * 0.7, 0, 8) * ctx.params.damageScale;
  if (damage > 0.5) {
    victim.hp = Math.max(0, victim.hp - damage);
    if (victim.hp <= 0) {
      victim.hp = 0;
      victim.state = 'ko';
      victim.stateTime = 0;
    }
  }
}

function resolveWorldHit(hit: QueuedHit, ctx: CombatContext): void {
  const fighterData = hit.a.kind === 'fighter' ? hit.a : hit.b.kind === 'fighter' ? hit.b : null;
  const worldData = hit.a.kind === 'world' ? hit.a : hit.b.kind === 'world' ? hit.b : null;
  if (!fighterData || fighterData.kind !== 'fighter' || !worldData || worldData.kind !== 'world') return;
  if (fighterData.part === 'footF' || fighterData.part === 'footB' || fighterData.part === 'lowerLegF' || fighterData.part === 'lowerLegB') {
    return;
  }
  const fighter = byId(ctx, fighterData.id);
  if (!fighter || fighter.spawnProtect > 0 || fighter.envCooldown > 0 || fighter.state === 'ko') return;
  if (worldData.surface === 'ground' && !(fighterData.part === 'head' && hit.relSpeed > 12)) return;
  if (hit.relSpeed < 8) return;
  fighter.envCooldown = 0.4;
  const damage = clamp((hit.relSpeed - 8) * 0.8, 0, 10) * ctx.params.damageScale;
  if (hit.relSpeed > 13 && fighter.state !== 'getup') {
    fighter.state = 'fallen';
    fighter.stateTime = 0;
    fighter.balanceMute = Math.max(fighter.balanceMute, 0.28);
    fighter.attack = null;
    fighter.strike = null;
  } else {
    fighter.hitStun = Math.max(fighter.hitStun, 0.16);
  }
  fighter.flash = 0.1;
  if (damage > 0.5) {
    fighter.hp = Math.max(0, fighter.hp - damage);
    ctx.effects.push({ kind: 'text', x: hit.px, y: hit.py, mag: damage, text: String(Math.round(damage)) });
    if (fighter.hp <= 0) {
      fighter.hp = 0;
      fighter.state = 'ko';
      fighter.stateTime = 0;
    }
  }
  ctx.effects.push({ kind: 'hit', x: hit.px, y: hit.py, mag: clamp(hit.relSpeed / 14, 0.3, 1.4), text: '' });
}

function strikeOf(f: Fighter, part: PartName, time: number): 'punch' | 'kick' | null {
  if (f.attackHit || !f.strike || time > f.strikeUntil) return null;
  if (f.strike === 'punch' && isPunch(part)) return 'punch';
  if (f.strike === 'kick' && isKick(part)) return 'kick';
  return null;
}

function isPunch(part: PartName): boolean {
  return part === 'handF' || part === 'handB' || part === 'lowerArmF' || part === 'lowerArmB' || part === 'upperArmF';
}

function isKick(part: PartName): boolean {
  return part === 'footF' || part === 'footB' || part === 'lowerLegF' || part === 'lowerLegB' || part === 'upperLegF';
}

function limbSpeed(body: Body): number {
  const v = body.getLinearVelocity();
  return Math.hypot(v.x, v.y);
}

function byId(ctx: CombatContext, id: FighterId): Fighter | undefined {
  return ctx.fighters.find((fighter) => fighter.id === id);
}

function footFrictionFor(fighter: Fighter, planted: number): number {
  if (fighter.state === 'fallen' || fighter.state === 'ko') return 0.35;
  if (fighter.state === 'walk' || fighter.state === 'sprint' || fighter.state === 'air' || fighter.state === 'stumble') {
    return 0.48;
  }
  return planted;
}

function isFootOnWorld(a: UserData, b: UserData): boolean {
  const fighter = a.kind === 'fighter' ? a : b.kind === 'fighter' ? b : null;
  const world = a.kind === 'world' || b.kind === 'world';
  return !!fighter && fighter.kind === 'fighter' && world && (fighter.part === 'footF' || fighter.part === 'footB');
}

function hitKey(hit: QueuedHit): string {
  const left = dataKey(hit.a);
  const right = dataKey(hit.b);
  return left < right ? `${left}|${right}` : `${right}|${left}`;
}

function dataKey(data: UserData): string {
  return data.kind === 'fighter' ? `${data.id}:${data.part}` : `world:${data.surface}`;
}
