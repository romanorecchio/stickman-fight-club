import {
  FIXED_DT,
  MAX_HP,
  PARTS,
  clamp,
  emptyInput,
  normalizeAngle,
  type BalanceParams,
  type EffectSnapshot,
  type FighterId,
  type FighterSnapshot,
  type InputFrame,
  type PartName,
  type PartPose,
  type PointName,
  type Snapshot,
  type Vec2,
  sanitizeBalance,
  DEFAULT_BALANCE,
} from '@sfc/shared';
import { Settings, World, type Body } from 'planck';
import { thinkDummy } from './ai.js';
import { buildArena } from './arena.js';
import { attachContacts, releaseGrab, resolveHits, tryAttachGrab, updateGrab, type EffectSpawn, type QueuedHit } from './combat.js';
import { driveFighter, prepareFighter } from './controller.js';
import { Fighter, type UserData } from './fighter.js';
import { ARENA, chooseSpawn, FOOT, HAND, HEAD, LOWER_ARM, LOWER_LEG, TORSO, UPPER_ARM, UPPER_LEG } from './metrics.js';

export interface SimOptions {
  seed?: number;
  ai?: boolean;
  balance?: Partial<BalanceParams>;
  spawns?: { player?: number; dummy?: number };
  spawnProtect?: number;
  /** `empty` starts with nobody, for an online room. Default builds the training pair. */
  roster?: 'training' | 'empty';
}

export interface FighterProbe {
  id: FighterId;
  x: number;
  y: number;
  hipY: number;
  angle: number;
  vx: number;
  vy: number;
  hp: number;
  state: Fighter['state'];
  grounded: boolean;
  facing: 1 | -1;
  grabbing: boolean;
  grabbed: boolean;
  jointSeparation: number;
  worstJoint: string;
  attack: 'punch' | 'kick' | null;
}

export interface StabilityReport {
  tick: number;
  nanEvents: number;
  rescueEvents: number;
  respawns: number;
  clampEvents: number;
  peakSpeed: number;
  peakAngular: number;
  maxJointSeparation: number;
  worstJointName: string;
  bodyCount: number;
  jointCount: number;
  hitsLanded: number;
}

const MAX_LINEAR = 40;
const MAX_ANGULAR = 55;

export class Simulation {
  readonly world: World;
  private readonly fighters = new Map<string, Fighter>();
  private nextGroup = 1;
  private readonly pending: Array<() => void> = [];
  private params: BalanceParams;
  private readonly ai: boolean;
  private readonly spawnPlayer: number;
  private readonly spawnDummy: number;
  private readonly spawnProtectDuration: number;
  private readonly solids: Snapshot['solids'];
  private readonly rng: () => number;
  private readonly hitQueue: QueuedHit[] = [];
  private effects: EffectSnapshot[] = [];
  private effectId = 1;
  private hits = { n: 0 };
  private readonly holdKo = new Set<string>();
  private readonly teams = new Map<string, string>();
  friendlyFire = true;

  get player(): Fighter {
    return this.must('player');
  }

  get dummy(): Fighter {
    return this.must('dummy');
  }

  tick = 0;
  time = 0;
  lastInputSeq = 0;
  nanEvents = 0;
  rescueEvents = 0;
  respawns = 0;
  clampEvents = 0;
  peakSpeed = 0;
  peakAngular = 0;
  maxJointSeparation = 0;
  worstJointName = 'neck';

  constructor(options: SimOptions = {}) {
    this.params = sanitizeBalance({ ...DEFAULT_BALANCE, ...options.balance });
    this.ai = options.ai !== false;
    this.spawnPlayer = options.spawns?.player ?? ARENA.spawnPlayer;
    this.spawnDummy = options.spawns?.dummy ?? ARENA.spawnDummy;
    this.spawnProtectDuration = options.spawnProtect ?? 0.7;
    this.rng = mulberry32(options.seed ?? 1);
    Settings.maxLinearCorrection = 0.4;
    this.world = new World({ gravity: { x: 0, y: this.params.gravity } });
    this.world.setAllowSleeping(true);
    this.solids = buildArena(this.world);
    if (options.roster !== 'empty') {
      this.spawnAt('player', 'YOU', 0, this.spawnPlayer, 1);
      this.spawnAt('dummy', 'DUMMY', 1, this.spawnDummy, -1);
    }
    attachContacts(this.world, this.hitQueue, () => this.combatContext());
  }

  /** Training-room entry. Online rooms call `stepAll`. */
  step(dt: number, input: InputFrame): void {
    const playerInput: InputFrame = { ...input, moveX: clamp(input.moveX, -1, 1) };
    const inputs = new Map<string, InputFrame>([['player', playerInput]]);
    const dummy = this.fighters.get('dummy');
    const player = this.fighters.get('player');
    if (dummy && player) {
      inputs.set(
        'dummy',
        this.ai
          ? thinkDummy(this.tick + 1, dummy, player, this.rng)
          : emptyInput(this.tick + 1, player.bodies.torso.getPosition().x - dummy.bodies.torso.getPosition().x, 0),
      );
    }
    this.stepAll(dt, inputs);
    this.lastInputSeq = playerInput.seq;
  }

  stepAll(dt: number, inputs: ReadonlyMap<string, InputFrame>): void {
    const stepDt = dt > 0 ? dt : FIXED_DT;
    this.flush();
    this.tick += 1;
    this.time += stepDt;
    this.hitQueue.length = 0;
    const roster = [...this.fighters.values()];

    for (const fighter of roster) {
      const input = inputs.get(fighter.id) ?? fighter.lastInput;
      fighter.vyPrev = fighter.bodies.torso.getLinearVelocity().y;
      prepareFighter(fighter, { ...input, moveX: clamp(input.moveX, -1, 1) }, stepDt, this.time, this.params);
    }
    for (const fighter of roster) {
      if (!fighter.throwQueued) continue;
      fighter.throwQueued = false;
      this.doThrow(fighter);
    }
    this.capVelocities(false);
    for (const fighter of roster) {
      const input = inputs.get(fighter.id) ?? fighter.lastInput;
      driveFighter(fighter, { ...input, moveX: clamp(input.moveX, -1, 1) }, stepDt, this.params, this.grabTarget(fighter));
    }

    this.world.step(stepDt, 22, 16);

    const spawned: EffectSpawn[] = [];
    const ctx = this.combatContext();
    ctx.effects = spawned;
    resolveHits(this.hitQueue, ctx);
    for (const effect of spawned) this.spawnEffect(effect);

    for (const fighter of [...this.fighters.values()]) this.afterPhysics(fighter, stepDt);
    this.capVelocities(true);
    this.decayEffects(stepDt);
  }

  addFighter(id: string, name: string, color: number): void {
    const run = () => {
      if (this.fighters.has(id) || this.fighters.size >= 8) return;
      const occupied = [...this.fighters.values()].map((fighter) => fighter.bodies.torso.getPosition().x);
      const x = chooseSpawn(occupied);
      const mean = occupied.length === 0 ? x + 1 : occupied.reduce((sum, value) => sum + value, 0) / occupied.length;
      this.spawnAt(id, name, color, x, mean >= x ? 1 : -1);
    };
    if (this.world.isLocked()) this.pending.push(run);
    else run();
  }

  removeFighter(id: string): void {
    const run = () => {
      const fighter = this.fighters.get(id);
      if (!fighter) return;
      this.breakGrabs(fighter);
      for (const part of PARTS) this.world.destroyBody(fighter.bodies[part]);
      this.fighters.delete(id);
    };
    if (this.world.isLocked()) this.pending.push(run);
    else run();
  }

  setDummyEnabled(enabled: boolean): void {
    if (enabled && !this.fighters.has('dummy')) this.spawnAt('dummy', 'DUMMY', 1, this.spawnDummy, -1);
    if (!enabled && this.fighters.has('dummy')) this.removeFighter('dummy');
  }

  applyFighterState(id: string, snap: FighterSnapshot): void {
    const fighter = this.fighters.get(id);
    if (!fighter) return;
    for (const part of snap.parts) {
      const body = fighter.bodies[part.part];
      body.setTransform({ x: part.x, y: part.y }, part.angle);
      body.setLinearVelocity({ x: snap.vx, y: snap.vy });
      body.setAngularVelocity(0);
      body.setAwake(true);
    }
    fighter.hp = snap.hp;
    if (fighter.state !== snap.state) fighter.stateTime = 0;
    fighter.state = snap.state;
    fighter.facing = snap.facing;
    fighter.grounded = snap.grounded;
    fighter.blocking = snap.blocking;
    fighter.attack = snap.attack;
    fighter.flash = snap.flash;
    fighter.spawnProtect = snap.protecting ? Math.max(fighter.spawnProtect, 0.2) : 0;
  }

  reset(): void {
    for (const fighter of this.fighters.values()) this.breakGrabs(fighter);
    const player = this.fighters.get('player');
    const dummy = this.fighters.get('dummy');
    if (player) {
      player.place(this.spawnPlayer);
      player.hp = MAX_HP;
      player.spawnProtect = this.spawnProtectDuration;
      player.facing = 1;
    }
    if (dummy) {
      dummy.place(this.spawnDummy);
      dummy.hp = MAX_HP;
      dummy.spawnProtect = this.spawnProtectDuration;
      dummy.facing = -1;
    }
    this.effects = [];
    this.hitQueue.length = 0;
  }

  setBalanceParams(partial: Partial<BalanceParams>): void {
    this.params = sanitizeBalance({ ...this.params, ...partial });
    this.world.setGravity({ x: 0, y: this.params.gravity });
  }

  getBalanceParams(): BalanceParams {
    return { ...this.params };
  }

  getProbe(id: FighterId): FighterProbe {
    const f = this.byId(id);
    const p = f.bodies.torso.getPosition();
    const v = f.bodies.torso.getLinearVelocity();
    const hip = f.bodies.torso.getWorldPoint({ x: 0, y: -TORSO.hy });
    return {
      id,
      x: p.x,
      y: p.y,
      hipY: hip.y,
      angle: normalizeAngle(f.bodies.torso.getAngle()),
      vx: v.x,
      vy: v.y,
      hp: f.hp,
      state: f.state,
      grounded: f.grounded,
      facing: f.facing,
      grabbing: f.grab !== null,
      grabbed: f.heldBy !== null,
      jointSeparation: f.maxSeparation(),
      worstJoint: f.worstJoint().name,
      attack: f.attack,
    };
  }

  getStability(): StabilityReport {
    return {
      tick: this.tick,
      nanEvents: this.nanEvents,
      rescueEvents: this.rescueEvents,
      respawns: this.respawns,
      clampEvents: this.clampEvents,
      peakSpeed: this.peakSpeed,
      peakAngular: this.peakAngular,
      maxJointSeparation: this.maxJointSeparation,
      worstJointName: this.worstJointName,
      bodyCount: this.world.getBodyCount(),
      jointCount: this.world.getJointCount(),
      hitsLanded: this.hits.n,
    };
  }

  getSnapshot(focusId = 'player'): Snapshot {
    const focus = this.fighters.get(focusId);
    const dummy = this.fighters.get('dummy');
    let banner: string | null = null;
    if (focus?.state === 'ko') banner = "YOU'RE DOWN";
    else if (focusId === 'player' && dummy?.state === 'ko') banner = 'DUMMY DOWN';
    else if (focus?.state === 'fallen') banner = 'GET UP';
    else if (focus?.state === 'getup') banner = 'GETTING UP';
    return {
      tick: this.tick,
      time: this.time,
      lastInputSeq: this.lastInputSeq,
      banner,
      fighters: [...this.fighters.values()].map((fighter) => this.snapshotFighter(fighter)),
      solids: this.solids,
      effects: this.effects.map((effect) => ({ ...effect })),
      bounds: { minX: ARENA.minX, maxX: ARENA.maxX, minY: ARENA.minY, maxY: ARENA.maxY },
    };
  }

  setRules(teams: Map<string, string>, friendlyFire: boolean): void {
    this.teams.clear();
    for (const [id, team] of teams) if (team === 'red' || team === 'blue') this.teams.set(id, team);
    this.friendlyFire = friendlyFire;
  }

  setHoldKo(id: string, hold: boolean): void {
    if (hold) this.holdKo.add(id);
    else this.holdKo.delete(id);
  }

  respawnFighter(id: string): void {
    const fighter = this.fighters.get(id);
    if (fighter) this.respawn(fighter);
  }

  setFighterHp(id: string, hp: number, maxHp = MAX_HP): void {
    const fighter = this.fighters.get(id);
    if (!fighter) return;
    fighter.hp = Math.max(0, Math.min(maxHp, hp));
    if (fighter.hp <= 0 && fighter.state !== 'ko') {
      fighter.hp = 0;
      fighter.state = 'ko';
      fighter.stateTime = 0;
      fighter.attack = null;
      fighter.strike = null;
    }
  }

  hurtBy(id: string): string | null {
    return this.fighters.get(id)?.lastHurtBy ?? null;
  }

  summaries(): { id: string; name: string; hp: number; state: Fighter['state']; x: number; y: number }[] {
    return [...this.fighters.values()].map((fighter) => {
      const pos = fighter.bodies.torso.getPosition();
      return { id: fighter.id, name: fighter.name, hp: fighter.hp, state: fighter.state, x: pos.x, y: pos.y };
    });
  }

  debugImpulse(id: FighterId, ix: number, iy: number, angular = 0): void {
    const f = this.byId(id);
    f.spawnProtect = 0;
    f.balanceMute = Math.max(f.balanceMute, 0.55);
    f.hitStun = Math.max(f.hitStun, 0.35);
    const torso = f.bodies.torso;
    torso.applyLinearImpulse({ x: ix, y: iy }, torso.getWorldCenter(), true);
    if (angular !== 0) torso.applyAngularImpulse(angular, true);
  }

  debugShift(id: FighterId, dx: number, dy: number): void {
    const f = this.byId(id);
    for (const part of PARTS) {
      const body = f.bodies[part];
      const p = body.getPosition();
      body.setTransform({ x: p.x + dx, y: p.y + dy }, body.getAngle());
      body.setAwake(true);
    }
  }

  private combatContext() {
    return {
      params: this.params,
      time: this.time,
      fighters: [...this.fighters.values()],
      teams: this.teams,
      friendlyFire: this.friendlyFire,
      hitsLanded: this.hits,
      effects: [] as EffectSpawn[],
    };
  }

  private afterPhysics(f: Fighter, dt: number): void {
    if (!this.fighters.has(f.id)) return;
    if (f.state === 'ko' && f.stateTime > 1.55 && !this.holdKo.has(f.id)) {
      this.respawn(f);
      return;
    }
    const grounded = sampleGrounded(this.world, f);
    if (grounded && !f.wasGrounded && f.state !== 'fallen' && f.state !== 'getup' && f.state !== 'ko') {
      if (f.vyPrev < -12.5) {
        f.state = 'fallen';
        f.stateTime = 0;
        f.balanceMute = Math.max(f.balanceMute, 0.25);
        f.attack = null;
        f.strike = null;
      } else if (f.vyPrev < -8) {
        f.hitStun = Math.max(f.hitStun, 0.14);
      }
    }
    f.grounded = grounded;
    f.coyote = grounded ? 0.12 : Math.max(0, f.coyote - dt);
    f.wasGrounded = grounded;

    const target = this.grabTarget(f);
    if (f.grabIntent > 0 && !f.grab && !f.heldBy && target) tryAttachGrab(this.world, f, target);
    if (f.grab) updateGrab(this.world, f, dt, this.params);

    this.sanitize(f);
  }

  private sanitize(f: Fighter): void {
    let peak = 0;
    let peakW = 0;
    for (const part of PARTS) {
      const body = f.bodies[part];
      const p = body.getPosition();
      const v = body.getLinearVelocity();
      const w = body.getAngularVelocity();
      if (
        !Number.isFinite(p.x) ||
        !Number.isFinite(p.y) ||
        !Number.isFinite(v.x) ||
        !Number.isFinite(v.y) ||
        !Number.isFinite(w) ||
        !Number.isFinite(body.getAngle())
      ) {
        this.nanEvents += 1;
        this.rescueEvents += 1;
        this.respawn(f);
        return;
      }
      const speed = Math.hypot(v.x, v.y);
      if (speed > peak) peak = speed;
      if (Math.abs(w) > peakW) peakW = Math.abs(w);
    }
    const sep = f.maxSeparation();
    if (!Number.isFinite(sep) || sep > 0.45) {
      this.rescueEvents += 1;
      this.respawn(f);
      return;
    }
    if (sep > this.maxJointSeparation) {
      this.maxJointSeparation = sep;
      this.worstJointName = f.worstJoint().name;
    }
    if (peak > this.peakSpeed) this.peakSpeed = peak;
    if (peakW > this.peakAngular) this.peakAngular = peakW;

    const torso = f.bodies.torso.getPosition();
    if (torso.y < -3 || torso.y > 16 || torso.x < -14 || torso.x > 14) this.respawn(f);
  }

  private respawn(f: Fighter): void {
    if (!this.fighters.has(f.id)) return;
    this.breakGrabs(f);
    const others = [...this.fighters.values()]
      .filter((other) => other !== f)
      .map((other) => other.bodies.torso.getPosition().x);
    const homeClear = others.every((x) => Math.abs(x - f.spawnX) >= 1.25);
    const x = homeClear ? f.spawnX : chooseSpawn(others);
    f.place(x);
    f.hp = MAX_HP;
    f.spawnProtect = this.spawnProtectDuration;
    const nearest = others.length === 0 ? x + 1 : others.reduce((best, value) => (Math.abs(value - x) < Math.abs(best - x) ? value : best));
    f.facing = nearest >= x ? 1 : -1;
    this.respawns += 1;
  }

  private breakGrabs(f: Fighter): void {
    if (f.grab) releaseGrab(this.world, f, null);
    if (f.heldBy?.grab) releaseGrab(this.world, f.heldBy, null);
  }

  private doThrow(f: Fighter): void {
    if (!f.grab) return;
    const aim = f.lastInput;
    const len = Math.hypot(aim.aimX, aim.aimY) || 1;
    const power = this.params.throwImpulse;
    const impulse = {
      x: (aim.aimX / len) * power,
      y: (aim.aimY / len) * power * 0.75 + power * 0.16,
    };
    const victim = releaseGrab(this.world, f, impulse);
    if (!victim) return;
    const p = victim.bodies.torso.getPosition();
    this.spawnEffect({ kind: 'throw', x: p.x, y: p.y + 0.3, mag: 1, text: '' });
    f.bodies.torso.applyLinearImpulse({ x: -impulse.x * 0.2, y: 0 }, f.bodies.torso.getWorldCenter(), true);
  }

  private spawnEffect(effect: EffectSpawn): void {
    const dir = this.effectId % 2 === 0 ? 1 : -1;
    this.effects.push({
      id: this.effectId++,
      kind: effect.kind,
      x: effect.x,
      y: effect.y,
      vx: effect.kind === 'hit' || effect.kind === 'throw' ? dir * 0.7 : 0,
      vy: effect.kind === 'text' ? 1.6 : 1.05,
      life: effect.kind === 'text' ? 0.7 : 0.28,
      max: effect.kind === 'text' ? 0.7 : 0.28,
      mag: effect.mag,
      text: effect.text,
    });
    if (this.effects.length > 40) this.effects.splice(0, this.effects.length - 40);
  }

  private decayEffects(dt: number): void {
    for (const effect of this.effects) {
      effect.life -= dt;
      effect.x += effect.vx * dt;
      effect.y += effect.vy * dt;
    }
    if (this.effects.some((effect) => effect.life <= 0)) {
      this.effects = this.effects.filter((effect) => effect.life > 0);
    }
  }

  private snapshotFighter(f: Fighter): FighterSnapshot {
    return {
      id: f.id,
      name: f.name,
      hp: f.hp,
      maxHp: MAX_HP,
      state: f.state,
      facing: f.facing,
      vx: f.bodies.torso.getLinearVelocity().x,
      vy: f.bodies.torso.getLinearVelocity().y,
      grounded: f.grounded,
      blocking: f.blocking,
      grabbing: f.grab !== null,
      grabbed: f.heldBy !== null,
      attack: f.attack,
      protecting: f.spawnProtect > 0,
      flash: f.flash,
      headAngle: f.bodies.head.getAngle(),
      color: f.color,
      parts: PARTS.map((part) => poseOf(f.bodies[part], part)),
      points: pointsOf(f),
    };
  }

  private capVelocities(count: boolean): void {
    for (const f of this.fighters.values()) {
      for (const part of PARTS) {
        const body = f.bodies[part];
        const v = body.getLinearVelocity();
        const speed = Math.hypot(v.x, v.y);
        if (speed > MAX_LINEAR) {
          const scale = MAX_LINEAR / speed;
          body.setLinearVelocity({ x: v.x * scale, y: v.y * scale });
          if (count) this.clampEvents += 1;
        }
        const w = body.getAngularVelocity();
        if (Math.abs(w) > MAX_ANGULAR) {
          body.setAngularVelocity(Math.sign(w) * MAX_ANGULAR);
          if (count) this.clampEvents += 1;
        }
      }
    }
  }

  private byId(id: FighterId): Fighter {
    return this.must(id);
  }

  private must(id: string): Fighter {
    const fighter = this.fighters.get(id);
    if (!fighter) throw new Error(`missing fighter ${id}`);
    return fighter;
  }

  private flush(): void {
    const jobs = this.pending.splice(0);
    for (const job of jobs) job();
  }

  private spawnAt(id: string, name: string, color: number, x: number, facing: 1 | -1): void {
    if (this.fighters.has(id)) return;
    const group = -this.nextGroup;
    this.nextGroup += 1;
    this.fighters.set(id, new Fighter(this.world, id, x, facing, this.spawnProtectDuration, group, name, color));
  }

  private grabTarget(f: Fighter): Fighter | null {
    const aim = f.lastInput;
    const len = Math.hypot(aim.aimX, aim.aimY) || 1;
    const dx = aim.aimX / len;
    const dy = aim.aimY / len;
    const origin = f.bodies.torso.getPosition();
    let best: { fighter: Fighter; dist: number } | null = null;
    for (const other of this.fighters.values()) {
      if (other === f) continue;
      const pos = other.bodies.torso.getPosition();
      const ox = pos.x - origin.x;
      const oy = pos.y - origin.y;
      const dist = Math.hypot(ox, oy);
      const dot = (ox * dx + oy * dy) / (dist || 1);
      if (dist < 2.4 && dot > 0.1 && (!best || dist < best.dist)) best = { fighter: other, dist };
    }
    return best?.fighter ?? null;
  }
}

function sampleGrounded(world: World, f: Fighter): boolean {
  for (const part of ['footF', 'footB'] as const) {
    const body = f.bodies[part];
    let edge = body.getContactList();
    while (edge) {
      const contact = edge.contact;
      if (contact.isTouching()) {
        const other = contact.getFixtureA().getBody() === body ? contact.getFixtureB() : contact.getFixtureA();
        const data = other.getUserData() as UserData | null;
        if (data?.kind === 'world') return true;
      }
      edge = edge.next;
    }
    const p = body.getPosition();
    let hit = false;
    world.rayCast({ x: p.x, y: p.y }, { x: p.x, y: p.y - 0.3 }, (fixture) => {
      const data = fixture.getUserData() as UserData | null;
      if (!data || data.kind === 'fighter') return -1;
      hit = true;
      return 0;
    });
    if (hit) return true;
  }
  return false;
}

function poseOf(body: Body, part: PartName): PartPose {
  const p = body.getPosition();
  const size = partSize(part);
  return {
    part,
    x: p.x,
    y: p.y,
    angle: body.getAngle(),
    shape: size.circle ? 'circle' : 'box',
    hx: size.hx,
    hy: size.hy,
  };
}

function partSize(part: PartName): { hx: number; hy: number; circle: boolean } {
  switch (part) {
    case 'head':
      return { hx: HEAD.r, hy: HEAD.r, circle: true };
    case 'torso':
      return { hx: TORSO.hx, hy: TORSO.hy, circle: false };
    case 'upperArmF':
    case 'upperArmB':
      return { hx: UPPER_ARM.hx, hy: UPPER_ARM.hy, circle: false };
    case 'lowerArmF':
    case 'lowerArmB':
      return { hx: LOWER_ARM.hx, hy: LOWER_ARM.hy, circle: false };
    case 'handF':
    case 'handB':
      return { hx: HAND.r, hy: HAND.r, circle: true };
    case 'upperLegF':
    case 'upperLegB':
      return { hx: UPPER_LEG.hx, hy: UPPER_LEG.hy, circle: false };
    case 'lowerLegF':
    case 'lowerLegB':
      return { hx: LOWER_LEG.hx, hy: LOWER_LEG.hy, circle: false };
    case 'footF':
    case 'footB':
      return { hx: FOOT.hx, hy: FOOT.hy, circle: false };
    default:
      return { hx: 0.05, hy: 0.05, circle: false };
  }
}

function pointsOf(f: Fighter): Record<PointName, Vec2> {
  const wp = (part: PartName, x: number, y: number): Vec2 => {
    const p = f.bodies[part].getWorldPoint({ x, y });
    return { x: p.x, y: p.y };
  };
  const pos = (part: PartName): Vec2 => {
    const p = f.bodies[part].getPosition();
    return { x: p.x, y: p.y };
  };
  return {
    head: pos('head'),
    neck: wp('torso', 0, TORSO.hy),
    shoulder: wp('torso', 0, TORSO.hy * 0.5),
    hip: wp('torso', 0, -TORSO.hy),
    elbowF: wp('upperArmF', 0, -UPPER_ARM.hy),
    wristF: wp('lowerArmF', 0, -LOWER_ARM.hy),
    handF: pos('handF'),
    elbowB: wp('upperArmB', 0, -UPPER_ARM.hy),
    wristB: wp('lowerArmB', 0, -LOWER_ARM.hy),
    handB: pos('handB'),
    kneeF: wp('upperLegF', 0, -UPPER_LEG.hy),
    ankleF: wp('lowerLegF', 0, -LOWER_LEG.hy),
    heelF: wp('footF', -FOOT.hx * 0.92, 0),
    toeF: wp('footF', FOOT.hx * 0.92, 0),
    kneeB: wp('upperLegB', 0, -UPPER_LEG.hy),
    ankleB: wp('lowerLegB', 0, -LOWER_LEG.hy),
    heelB: wp('footB', -FOOT.hx * 0.92, 0),
    toeB: wp('footB', FOOT.hx * 0.92, 0),
  };
}

function mulberry32(seed: number): () => number {
  let a = (seed || 1) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
