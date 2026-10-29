import {
  Box,
  Circle,
  RevoluteJoint,
  World,
  type Body,
  type DistanceJoint,
  type Fixture,
} from 'planck';
import {
  CATEGORY_FIGHTER,
  CATEGORY_WORLD,
  JOINTS,
  PARTS,
  type FighterId,
  type FighterState,
  type InputFrame,
  type JointName,
  type PartName,
  emptyInput,
} from '@sfc/shared';
import {
  DENSITY,
  FOOT,
  HAND,
  HEAD,
  LOWER_ARM,
  LOWER_LEG,
  TORSO,
  UPPER_ARM,
  UPPER_LEG,
  layoutCharacter,
} from './metrics.js';

export type UserData =
  | { kind: 'fighter'; id: FighterId; part: PartName }
  | { kind: 'world'; surface: 'ground' | 'wall' | 'platform' | 'crate' };

export interface GrabState {
  joint: DistanceJoint;
  victim: Fighter;
  victimPart: PartName;
  timer: number;
  struggle: number;
}

export class Fighter {
  readonly id: FighterId;
  readonly name: string;
  readonly bodies: Record<PartName, Body>;
  readonly fixtures: Record<PartName, Fixture>;
  readonly joints: Record<JointName, RevoluteJoint>;
  facing: 1 | -1;
  hp = 100;
  state: FighterState = 'idle';
  stateTime = 0;
  grounded = true;
  wasGrounded = true;
  coyote = 0.12;
  jumpBuffer = 0;
  jumpAge = 0;
  canCutJump = false;
  throwQueued = false;
  prevJump = false;
  prevGrab = false;
  prevThrow = false;
  phase = 0;
  hitStun = 0;
  balanceMute = 0;
  limitOpen = 0;
  spawnProtect: number;
  attack: 'punch' | 'kick' | null = null;
  attackTime = 0;
  strike: 'punch' | 'kick' | null = null;
  strikeUntil = 0;
  attackHit = false;
  cooldownPunch = 0;
  cooldownKick = 0;
  grabIntent = 0;
  blocking = false;
  flash = 0;
  vyPrev = 0;
  spawnX: number;
  targets: Record<JointName, number>;
  grab: GrabState | null = null;
  heldBy: Fighter | null = null;
  lastInput: InputFrame;
  envCooldown = 0;
  lastHurtBy: string | null = null;
  readonly color: number;

  constructor(
    world: World,
    id: FighterId,
    x: number,
    facing: 1 | -1,
    spawnProtect: number,
    group = id === 'player' ? -1 : id === 'dummy' ? -2 : -3,
    name = id === 'player' ? 'YOU' : id === 'dummy' ? 'DUMMY' : id,
    color = id === 'dummy' ? 1 : 0,
  ) {
    this.id = id;
    this.name = name;
    this.color = color;
    this.facing = facing;
    this.spawnX = x;
    this.spawnProtect = spawnProtect;
    this.lastInput = emptyInput(0, facing, 0);
    this.targets = zeroTargets();
    const layout = layoutCharacter(x);
    const bodies = {} as Record<PartName, Body>;
    const fixtures = {} as Record<PartName, Fixture>;

    for (const part of PARTS) {
      const at = layout[part];
      const body = world.createDynamicBody({
        position: at,
        angle: 0,
        linearDamping: part === 'torso' ? 0.4 : 1.05,
        angularDamping: part === 'torso' || part === 'head' ? 3.4 : 4,
        allowSleep: false,
        bullet: false,
      });
      const userData: UserData = { kind: 'fighter', id, part };
      body.setUserData(userData);
      const fixture = body.createFixture(shapeFor(part), {
        density: DENSITY[part],
        friction: part.startsWith('foot') ? 1.15 : 0.35,
        restitution: part === 'head' ? 0.05 : 0.01,
        filterGroupIndex: group,
        filterCategoryBits: CATEGORY_FIGHTER,
        filterMaskBits: CATEGORY_WORLD | CATEGORY_FIGHTER,
        userData,
      });
      bodies[part] = body;
      fixtures[part] = fixture;
    }

    this.bodies = bodies;
    this.fixtures = fixtures;
    this.joints = {
      neck: hinge(world, bodies.torso, bodies.head, [0, TORSO.hy], [0, -HEAD.r], [-0.85, 0.85]),
      shoulderF: hinge(world, bodies.torso, bodies.upperArmF, [0, TORSO.hy * 0.5], [0, UPPER_ARM.hy], [-2.9, 2.9]),
      shoulderB: hinge(world, bodies.torso, bodies.upperArmB, [0, TORSO.hy * 0.5], [0, UPPER_ARM.hy], [-2.9, 2.9]),
      elbowF: hinge(world, bodies.upperArmF, bodies.lowerArmF, [0, -UPPER_ARM.hy], [0, LOWER_ARM.hy], [-0.25, 2.6]),
      elbowB: hinge(world, bodies.upperArmB, bodies.lowerArmB, [0, -UPPER_ARM.hy], [0, LOWER_ARM.hy], [-0.25, 2.6]),
      wristF: hinge(world, bodies.lowerArmF, bodies.handF, [0, -LOWER_ARM.hy], [0, HAND.r], [-1.15, 1.15]),
      wristB: hinge(world, bodies.lowerArmB, bodies.handB, [0, -LOWER_ARM.hy], [0, HAND.r], [-1.15, 1.15]),
      hipF: hinge(world, bodies.torso, bodies.upperLegF, [0, -TORSO.hy], [0, UPPER_LEG.hy], [-1.2, 2.05]),
      hipB: hinge(world, bodies.torso, bodies.upperLegB, [0, -TORSO.hy], [0, UPPER_LEG.hy], [-1.2, 2.05]),
      kneeF: hinge(world, bodies.upperLegF, bodies.lowerLegF, [0, -UPPER_LEG.hy], [0, LOWER_LEG.hy], [-2.6, 0.3]),
      kneeB: hinge(world, bodies.upperLegB, bodies.lowerLegB, [0, -UPPER_LEG.hy], [0, LOWER_LEG.hy], [-2.6, 0.3]),
      ankleF: hinge(world, bodies.lowerLegF, bodies.footF, [0, -LOWER_LEG.hy], [0, FOOT.hy], [-0.95, 0.95]),
      ankleB: hinge(world, bodies.lowerLegB, bodies.footB, [0, -LOWER_LEG.hy], [0, FOOT.hy], [-0.95, 0.95]),
    };
  }

  place(x: number): void {
    const layout = layoutCharacter(x);
    for (const part of PARTS) {
      const body = this.bodies[part];
      const at = layout[part];
      body.setTransform(at, 0);
      body.setLinearVelocity({ x: 0, y: 0 });
      body.setAngularVelocity(0);
      body.setAwake(true);
    }
    this.spawnX = x;
    this.targets = zeroTargets();
    this.phase = 0;
    this.state = 'idle';
    this.stateTime = 0;
    this.hitStun = 0;
    this.balanceMute = 0;
    this.attack = null;
    this.attackTime = 0;
    this.strike = null;
    this.strikeUntil = 0;
    this.attackHit = false;
    this.grabIntent = 0;
    this.blocking = false;
    this.flash = 0;
    this.vyPrev = 0;
    this.wasGrounded = true;
    this.grounded = true;
    this.coyote = 0.12;
    this.jumpBuffer = 0;
    this.jumpAge = 0;
    this.canCutJump = false;
    this.throwQueued = false;
    this.cooldownPunch = 0;
    this.cooldownKick = 0;
    this.envCooldown = 0;
    for (const name of JOINTS) {
      this.joints[name].setMotorSpeed(0);
    }
  }

  maxSeparation(): number {
    return this.worstJoint().separation;
  }

  worstJoint(): { name: JointName; separation: number } {
    let separation = 0;
    let name: JointName = 'neck';
    for (const jointName of JOINTS) {
      const joint = this.joints[jointName];
      const a = joint.getAnchorA();
      const b = joint.getAnchorB();
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (d > separation) {
        separation = d;
        name = jointName;
      }
    }
    return { name, separation };
  }
}

function zeroTargets(): Record<JointName, number> {
  const targets = {} as Record<JointName, number>;
    for (const name of JOINTS) targets[name] = 0;
  return targets;
}

function shapeFor(part: PartName): Box | Circle {
  switch (part) {
    case 'head':
      return new Circle(HEAD.r);
    case 'torso':
      return new Box(TORSO.hx, TORSO.hy);
    case 'upperArmF':
    case 'upperArmB':
      return new Box(UPPER_ARM.hx, UPPER_ARM.hy);
    case 'lowerArmF':
    case 'lowerArmB':
      return new Box(LOWER_ARM.hx, LOWER_ARM.hy);
    case 'handF':
    case 'handB':
      return new Circle(HAND.r);
    case 'upperLegF':
    case 'upperLegB':
      return new Box(UPPER_LEG.hx, UPPER_LEG.hy);
    case 'lowerLegF':
    case 'lowerLegB':
      return new Box(LOWER_LEG.hx, LOWER_LEG.hy);
    case 'footF':
    case 'footB':
      return new Box(FOOT.hx, FOOT.hy);
    default:
      return new Box(0.05, 0.05);
  }
}

function hinge(
  world: World,
  bodyA: Body,
  bodyB: Body,
  anchorA: [number, number],
  anchorB: [number, number],
  limit: [number, number],
): RevoluteJoint {
  const joint = world.createJoint(
    new RevoluteJoint({
      bodyA,
      bodyB,
      localAnchorA: { x: anchorA[0], y: anchorA[1] },
      localAnchorB: { x: anchorB[0], y: anchorB[1] },
      enableLimit: true,
      lowerAngle: limit[0],
      upperAngle: limit[1],
      enableMotor: true,
      maxMotorTorque: 20,
      motorSpeed: 0,
      collideConnected: false,
      referenceAngle: 0,
    }),
  );
  if (!joint) throw new Error('failed to create revolute joint');
  return joint;
}
