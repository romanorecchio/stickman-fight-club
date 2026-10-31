import {
  JOINTS,
  PARTS,
  clamp,
  dampAngle,
  normalizeAngle,
  type BalanceParams,
  type InputFrame,
  type JointName,
} from '@sfc/shared';
import type { RevoluteJoint } from 'planck';
import { noise01, type Fighter, type UserData } from './fighter.js';
import { bendSign, solveTwoLink } from './ik.js';
import { LEN, TORSO } from './metrics.js';

interface CharacterPose {
  shoulderF: number;
  elbowF: number;
  wristF: number;
  shoulderB: number;
  elbowB: number;
  wristB: number;
  hipF: number;
  kneeF: number;
  hipB: number;
  kneeB: number;
}

export function prepareFighter(f: Fighter, input: InputFrame, dt: number, time: number, params: BalanceParams): void {
  f.lastInput = input;
  f.clock = time;
  f.dizzy = Math.max(0, f.dizzy - dt);
  f.daze = Math.max(0, f.daze - dt * 0.35);
  f.getupGrace = Math.max(0, f.getupGrace - dt);
  f.groundY = probeGround(f);
  const vx = f.bodies.torso.getLinearVelocity().x;
  f.laggedVx += (vx - f.laggedVx) * (1 - Math.exp(-3.2 * dt));
  f.cooldownPunch = Math.max(0, f.cooldownPunch - dt);
  f.cooldownKick = Math.max(0, f.cooldownKick - dt);
  f.hitStun = Math.max(0, f.hitStun - dt);
  f.balanceMute = Math.max(0, f.balanceMute - dt);
  f.limitOpen = Math.max(0, f.limitOpen - dt);
  f.spawnProtect = Math.max(0, f.spawnProtect - dt);
  f.flash = Math.max(0, f.flash - dt);
  f.envCooldown = Math.max(0, f.envCooldown - dt);
  f.grabIntent = Math.max(0, f.grabIntent - dt);
  if (f.attackTime > 0) {
    f.attackTime -= dt;
    if (f.attackTime <= 0) f.attack = null;
  }
  if (f.strike && time > f.strikeUntil) f.strike = null;

  if (input.jump && !f.prevJump) f.jumpBuffer = 0.14;
  else f.jumpBuffer = Math.max(0, f.jumpBuffer - dt);
  f.prevJump = input.jump;

  const angle = normalizeAngle(f.bodies.torso.getAngle());
  const canAct = f.state !== 'fallen' && f.state !== 'ko' && f.state !== 'getup';

  if (canAct && Math.abs(angle) < 0.85 && f.limitOpen <= 0) {
    let want = f.facing;
    if (Math.abs(input.aimX) > 0.4) want = input.aimX >= 0 ? 1 : -1;
    else if (Math.abs(input.moveX) > 0.1) want = input.moveX > 0 ? 1 : -1;
    if (want !== f.facing) {
      f.facing = want;
      f.limitOpen = 0.45;
    }
  }

  // One attack button: on the ground it's a haymaker, in the air it's a flying drop-kick.
  const airKick = input.punch && !f.grounded && !f.weaponId && f.state === 'air';
  if ((input.kick || airKick) && f.cooldownKick <= 0 && canAct) {
    beginStrike(f, 'kick', time);
  } else if (input.punch && f.cooldownPunch <= 0 && canAct && f.attack !== 'kick') {
    beginStrike(f, 'punch', time);
  }

  // One grab button: press to grab, press again while holding someone to throw them.
  if (input.grab && !f.prevGrab && f.grab) f.throwQueued = true;
  else if (input.grab && !f.prevGrab && canAct && !f.grab && !f.heldBy) {
    f.grabIntent = 0.48;
    if (f.attack === 'punch') f.attack = null;
  }
  f.prevGrab = input.grab;

  if (input.throw && !f.prevThrow && f.grab) f.throwQueued = true;
  f.prevThrow = input.throw;

  f.blocking = input.block && canAct && f.attack === null && f.grabIntent <= 0 && !f.grab;

  updateState(f, input, dt, params);
}

export function driveFighter(f: Fighter, input: InputFrame, dt: number, params: BalanceParams, other: Fighter | null): void {
  const torso = f.bodies.torso;
  const angle = normalizeAngle(torso.getAngle());
  const angVel = torso.getAngularVelocity();
  const vel = torso.getLinearVelocity();
  const hip = torso.getWorldPoint({ x: 0, y: -TORSO.hy });
  const limp = f.state === 'fallen' || f.state === 'ko';

  const footFriction =
    limp ? 0.35 : f.state === 'walk' || f.state === 'sprint' || f.state === 'air' || f.state === 'stumble' ? 0.48 : params.footFriction;
  f.fixtures.footF.setFriction(footFriction);
  f.fixtures.footB.setFriction(footFriction);

  if (!limp) {
    const mute = f.balanceMute > 0 ? 0.1 : f.hitStun > 0 ? 0.42 : f.state === 'stumble' ? 0.5 : 1;
    const getupBoost = f.state === 'getup' ? 1.3 : 1;
    const held = f.heldBy ? 0.6 : 1;
    const target = f.state === 'getup' ? wobbleTarget(f) * 0.6 : drunkLean(f, vel.x);
    let torque = normalizeAngle(target - angle) * params.uprightKp * mute * getupBoost * held - angVel * params.uprightKd;
    torque = clamp(torque, -params.maxUprightTorque, params.maxUprightTorque);
    torso.applyTorque(torque, true);
  }

  let targetVx = 0;
  if (!limp && f.state !== 'getup') {
    const speed = (input.crouch || f.state === 'crouch' ? params.crouchSpeed : input.sprint ? params.sprintSpeed : params.walkSpeed) * f.moveScale;
    targetVx = clamp(input.moveX, -1, 1) * speed;
    const [a1, a2] = phases(f);
    if (Math.abs(targetVx) > 0.05) {
      // Surge and hesitate like someone who had six beers.
      targetVx *= 1 + 0.22 * Math.sin(f.clock * 2.6 + a1) + 0.12 * Math.sin(f.clock * 5.9 + a2);
    } else if (f.grounded && f.attack === null && !f.blocking && !f.grab) {
      // Standing still is a negotiation: drift back and forth a little.
      const drunk = f.dizzy > 0 ? 2.2 : 1;
      targetVx = drunk * (0.1 * Math.sin(f.clock * 0.83 + a2) + 0.05 * Math.sin(f.clock * 1.9 + a1));
    }
    if (f.blocking) targetVx *= 0.55;
    if (f.attack === 'kick') targetVx *= 0.45;
  }
  const accel = !f.grounded ? params.airControl : limp ? 0 : f.balanceMute > 0 ? 0.15 : f.heldBy ? 0.45 : 1;
  const fx = clamp((targetVx - vel.x) * params.speedKp * accel, -params.maxBalanceForce, params.maxBalanceForce);
  if (Math.abs(fx) > 0.5) torso.applyForce({ x: fx, y: 0 }, hip, true);

  const hipH = hip.y - f.groundY;
  if (f.grounded && f.balanceMute <= 0 && (f.state === 'idle' || f.state === 'walk' || f.state === 'sprint' || f.state === 'stumble')) {
    // Springy, under-damped hip support: the body bobs on every step instead of riding a rail.
    const moving = f.state === 'walk' || f.state === 'sprint';
    const want = 0.79 - (moving ? 0.05 * Math.abs(Math.sin(f.phase)) : 0.015 + 0.015 * Math.sin(f.clock * 2.2));
    const err = want - hipH;
    if (err > -0.04) torso.applyForceToCenter({ x: 0, y: clamp(err * 900 - vel.y * 14, 0, 300) }, true);
  }
  if (f.grounded && f.state === 'crouch') {
    const err = 0.48 - hipH;
    if (err < -0.02) torso.applyForceToCenter({ x: 0, y: clamp(err * 320, -200, 0) }, true);
  }
  if (f.state === 'getup' && f.stateTime > 0.28 && f.grounded && hipH < 0.74) {
    torso.applyForceToCenter({ x: 0, y: clamp((0.8 - hipH) * 220, 0, 210) }, true);
  }

  if (f.canCutJump) f.jumpAge += dt;
  if (
    f.jumpBuffer > 0 &&
    f.coyote > 0 &&
    f.state !== 'fallen' &&
    f.state !== 'ko' &&
    f.state !== 'getup'
  ) {
    f.jumpBuffer = 0;
    f.coyote = 0;
    f.canCutJump = true;
    f.jumpAge = 0;
    for (const part of PARTS) {
      const body = f.bodies[part];
      const v = body.getLinearVelocity();
      const add = params.jumpSpeed - v.y;
      if (add > 0) body.applyLinearImpulse({ x: 0, y: body.getMass() * add }, body.getWorldCenter(), true);
    }
  } else if (f.canCutJump && !input.jump && f.jumpAge > 0.09 && vel.y > 2.4) {
    for (const part of PARTS) {
      const body = f.bodies[part];
      const v = body.getLinearVelocity();
      if (v.y > 0) body.setLinearVelocity({ x: v.x, y: v.y * 0.52 });
    }
    f.canCutJump = false;
  }

  const open = f.limitOpen > 0;
  for (const name of JOINTS) {
    const [lo, hi] = limitsFor(name, f.facing, open);
    f.joints[name].setLimits(lo, hi);
  }

  if (limp) {
    // A whisper of joint friction lets a limp body settle instead of buzzing on the floor.
    for (const name of JOINTS) {
      f.joints[name].setMotorSpeed(0);
      f.joints[name].setMaxMotorTorque(name === 'neck' ? 0.5 : 1.2);
    }
    return;
  }

  const desired = desiredWorld(f, input, other, torso.getAngle());
  const kicking = f.attack === 'kick';
  const rate = f.attack || f.grabIntent > 0 || f.grab ? 26 : params.poseSmoothing;
  for (const name of JOINTS) {
    const [lo, hi] = limitsFor(name, f.facing, open);
    const clamped = clamp(desired[name], lo + 0.04, hi - 0.04);
    f.targets[name] = clamp(dampAngle(f.targets[name], clamped, rate, dt), lo + 0.04, hi - 0.04);
    const torque = torqueFor(name, f, params, kicking);
    const fast =
      (f.attack === 'punch' && (name === 'shoulderF' || name === 'elbowF')) ||
      (f.attack === 'kick' && (name === 'hipF' || name === 'kneeF'));
    driveJoint(f.joints[name], f.targets[name], torque, params.motorGain, fast ? params.attackMotorSpeed : params.maxMotorSpeed);
  }
}

function beginStrike(f: Fighter, kind: 'punch' | 'kick', time: number): void {
  f.attack = kind;
  f.strike = kind;
  f.attackHit = false;
  f.grabIntent = 0;
  if (kind === 'punch') {
    f.attackTime = 0.14;
    f.strikeUntil = time + 0.24;
    f.cooldownPunch = 0.38;
  } else {
    f.attackTime = 0.17;
    f.strikeUntil = time + 0.28;
    f.cooldownKick = 0.55;
  }
}

function updateState(f: Fighter, input: InputFrame, dt: number, params: BalanceParams): void {
  const angle = normalizeAngle(f.bodies.torso.getAngle());
  const angVel = f.bodies.torso.getAngularVelocity();
  const hipY = f.bodies.torso.getWorldPoint({ x: 0, y: -TORSO.hy }).y - f.groundY;
  const abs = Math.abs(angle);

  if (f.state === 'ko') {
    f.stateTime += dt;
    return;
  }

  if (f.state === 'fallen') {
    f.stateTime += dt;
    const vel = f.bodies.torso.getLinearVelocity();
    const calm = Math.abs(angVel) < 2.4 && Math.hypot(vel.x, vel.y) < 2.1;
    if ((f.stateTime > f.downFor && calm) || f.stateTime > f.downFor + 0.65) {
      f.state = 'getup';
      f.stateTime = 0;
      f.downFor = 0.42;
      f.attack = null;
      f.strike = null;
    }
    return;
  }

  if (f.state === 'getup') {
    f.stateTime += dt;
    // After a while, "upright enough" counts: a ledge overhead or a half-crouch must not
    // trap a fighter in an endless getup loop - let them stagger out of it instead.
    const up = f.grounded && ((abs < 0.38 && hipY > 0.66) || (f.stateTime > 1.3 && abs < 0.75));
    // Dizzy fighters take a beat longer, wobbling, before they trust their legs.
    if (up && f.stateTime > (f.dizzy > 0 ? 0.75 : 0.3)) {
      f.getupGrace = 0.9;
      f.state = 'idle';
      f.stateTime = 0;
      f.balanceMute = 0;
    } else if (abs > params.fallAngle + 0.35 && f.stateTime > 0.45) {
      f.state = 'fallen';
      f.stateTime = 0;
    } else if (f.stateTime > 2.3) {
      f.state = 'fallen';
      f.stateTime = 0;
    }
    return;
  }

  const low = hipY < 0.34 && f.state !== 'crouch';
  const spinning = Math.abs(angVel) > 8 && f.balanceMute > 0;
  if (abs > params.fallAngle || low || spinning) {
    f.state = 'fallen';
    f.stateTime = 0;
    f.attack = null;
    f.strike = null;
    return;
  }

  if (f.hitStun > 0 && abs > params.stumbleAngle * 0.4) f.state = 'stumble';
  else if (!f.grounded) f.state = 'air';
  else if (input.crouch) f.state = 'crouch';
  else if (Math.abs(input.moveX) > 0.1) f.state = input.sprint ? 'sprint' : 'walk';
  else f.state = 'idle';

  const vx = f.bodies.torso.getLinearVelocity().x;
  const spread = Math.abs(f.bodies.footF.getPosition().x - f.bodies.footB.getPosition().x);
  const catching = f.state === 'idle' && f.grounded && (Math.abs(angle) > 0.13 || Math.abs(vx) > 0.32 || spread > 0.34);
  f.stepping = (f.state === 'walk' || f.state === 'sprint' || catching) && f.grounded;
  if (f.stepping) {
    // Every step is its own little decision: stride, lift and tempo all vary.
    const rate = catching ? 5.2 : f.state === 'sprint' ? 10.2 : 6.4 + Math.abs(vx) * 0.55;
    f.phase += dt * rate * (0.8 + 0.45 * noise01(f.seed, f.stepIndex * 3 + 2));
    const step = Math.floor(f.phase / Math.PI);
    if (step !== f.stepIndex) {
      f.stepIndex = step;
      f.stepStride = 0.7 + 0.65 * noise01(f.seed, step * 3);
      f.stepLift = 0.65 + 0.8 * noise01(f.seed, step * 3 + 1);
    }
  } else {
    f.phase = normalizeAngle(f.phase) * Math.exp(-7 * dt);
    f.stepIndex = Math.floor(f.phase / Math.PI);
  }
}

function desiredWorld(f: Fighter, input: InputFrame, other: Fighter | null, torsoAngle: number): Record<JointName, number> {
  const pose = characterPose(f, input);
  const world = toWorld(pose, f.facing);
  const torso = f.bodies.torso;
  const dir = aimDir(input);
  if (f.state !== 'getup') {
    // Legs reach out to catch a leaning torso: overcompensate a little, so a lean turns
    // into a stumbling catch-step instead of a stiff plank tipping over.
    const tilt = normalizeAngle(torsoAngle);
    const lean = tilt + clamp(tilt * 0.3, -0.25, 0.25);
    world.hipF = normalizeAngle(world.hipF - lean);
    world.hipB = normalizeAngle(world.hipB - lean);
  }

  if (f.attack === 'punch' || f.grabIntent > 0 || f.grab) {
    const origin = torso.getWorldPoint({ x: 0, y: TORSO.hy * 0.5 });
    let target = {
      x: origin.x + dir.x * (LEN.upperArm + LEN.lowerArm - 0.02),
      y: origin.y + dir.y * (LEN.upperArm + LEN.lowerArm - 0.02),
    };
    if (f.grab) {
      const held = f.grab.victim.bodies[f.grab.victimPart].getPosition();
      target = { x: held.x, y: held.y };
    } else if (f.grabIntent > 0 && other) {
      const grabbed = grabAim(origin, other, dir);
      if (grabbed) target = grabbed;
    }
    const solved = solveTwoLink(
      origin,
      target,
      torso.getAngle(),
      LEN.upperArm,
      LEN.lowerArm,
      bendSign(Math.atan2(target.y - origin.y, target.x - origin.x), false),
    );
    world.shoulderF = solved.joint1;
    world.elbowF = solved.joint2;
    world.wristF = 0.15 * f.facing;
  }

  if (f.attack === 'kick') {
    const origin = torso.getWorldPoint({ x: 0, y: -TORSO.hy });
    const target = {
      x: origin.x + dir.x * (LEN.upperLeg + LEN.lowerLeg - 0.02),
      y: origin.y + dir.y * (LEN.upperLeg + LEN.lowerLeg - 0.02),
    };
    const solved = solveTwoLink(
      origin,
      target,
      torso.getAngle(),
      LEN.upperLeg,
      LEN.lowerLeg,
      bendSign(dir.angle, true),
    );
    world.hipF = solved.joint1;
    world.kneeF = solved.joint2;
  }

  const [, b2] = phases(f);
  const bob = 0.22 * Math.sin(f.clock * 2.1 + b2) + (f.state === 'walk' || f.state === 'sprint' ? 0.18 * Math.sin(f.phase * 2) : 0);
  world.neck = clamp(normalizeAngle(f.facing * 0.05 + bob - torso.getAngle()), -0.8, 0.8);
  world.ankleF = clamp(-f.bodies.lowerLegF.getAngle(), -0.9, 0.9);
  world.ankleB = clamp(-f.bodies.lowerLegB.getAngle(), -0.9, 0.9);
  return world;
}

function characterPose(f: Fighter, input: InputFrame): CharacterPose {
  const [a1, a2, a3] = phases(f);
  const t = f.clock;
  if (f.state === 'getup') {
    const early = f.stateTime < 0.42;
    // Shaky baby-deer legs and arms windmilling for balance.
    const shake = (f.dizzy > 0 ? 0.28 : 0.14) * Math.sin(t * 21 + a1);
    const flail = Math.sin(t * 8.5 + a2);
    return {
      shoulderF: early ? 0.55 : 1.5 + 0.8 * flail,
      elbowF: early ? 0.35 : 0.5,
      wristF: 0.1,
      shoulderB: early ? 0.35 : 1.3 - 0.8 * flail,
      elbowB: 0.4,
      wristB: 0.1,
      hipF: early ? 0.85 : 0.3 + shake,
      kneeF: early ? 2.05 : 0.5 + Math.abs(shake),
      hipB: early ? 0.7 : 0.1 - shake,
      kneeB: early ? 2.0 : 0.45 + Math.abs(shake),
    };
  }

  if (f.state === 'air' || !f.grounded) {
    // Cartoon panic: windmill the arms and bicycle the legs.
    const spin = t * 13;
    return {
      shoulderF: 1.3 + 1.25 * Math.sin(spin),
      elbowF: 0.5 + 0.3 * Math.sin(spin * 1.3),
      wristF: 0.1,
      shoulderB: 1.3 + 1.25 * Math.sin(spin + Math.PI),
      elbowB: 0.5,
      wristB: 0.1,
      hipF: 0.35 + 0.45 * Math.sin(t * 10),
      kneeF: 0.9 + 0.4 * Math.sin(t * 10 + 1),
      hipB: 0.1 - 0.45 * Math.sin(t * 10),
      kneeB: 0.8 - 0.4 * Math.sin(t * 10 + 1),
    };
  }

  if (f.state === 'crouch' || input.crouch) {
    return {
      shoulderF: 0.85,
      elbowF: 1.05,
      wristF: 0.15,
      shoulderB: 0.55,
      elbowB: 0.85,
      wristB: 0.1,
      hipF: 0.5,
      kneeF: 1.75,
      hipB: 0.28,
      kneeB: 1.7,
    };
  }

  const moving = f.state === 'walk' || f.state === 'sprint' || Math.abs(normalizeAngle(f.phase)) > 0.05;
  const sprint = f.state === 'sprint';
  const sF = Math.sin(f.phase);
  const sB = -sF;
  const odd = (f.stepIndex & 1) === 1;
  // Stride and knee lift are re-rolled every step, so no two steps match.
  // Idle "catch" steps are little shuffles; real walking takes big goofy strides.
  const shuffle = f.state === 'idle' ? 0.35 : 1;
  const stride = (sprint ? 0.7 : 0.58) * f.stepStride * (moving ? shuffle : 0);
  const lift = (sprint ? 1.35 : 1.2) * f.stepLift * (moving ? shuffle : 0);
  const lead = moving ? clamp(f.bodies.torso.getLinearVelocity().x * f.facing * 0.07, -0.3, 0.3) : 0;
  const knees = 0.2 + 0.08 * Math.sin(t * 4.1 + a3) + (f.dizzy > 0 ? 0.15 : 0);
  // Arms: noodles on a breeze while idle, flailing while walking.
  const flail = moving ? (sprint ? 1.0 : 0.8) : 0.18;
  const pose: CharacterPose = {
    shoulderF: (moving ? 0.6 : 0.35) - sF * flail + 0.5 * Math.sin(t * 3.1 + a1) * (moving ? 1 : 0.5),
    elbowF: 0.55 + 0.35 * Math.sin(t * 4.3 + a2),
    wristF: 0.12,
    shoulderB: (moving ? 0.5 : 0.3) - sB * flail * 0.9 + 0.5 * Math.sin(t * 2.6 + a3) * (moving ? 1 : 0.5),
    elbowB: 0.5 + 0.35 * Math.sin(t * 3.7 + a1),
    wristB: 0.1,
    hipF: sF * stride * (odd ? 1.25 : 1) + lead,
    kneeF: knees + Math.max(0, sF) * lift,
    hipB: sB * stride * (odd ? 1 : 1.25) + lead,
    kneeB: knees + Math.max(0, sB) * lift,
  };

  if (f.state === 'stumble') {
    const wave = Math.sin(t * 11);
    pose.shoulderF = 1.9 + 0.7 * wave;
    pose.elbowF = 0.35;
    pose.shoulderB = 1.6 - 0.7 * wave;
    pose.elbowB = 0.3;
    pose.kneeF = Math.max(pose.kneeF, 0.45);
    pose.kneeB = Math.max(pose.kneeB, 0.45);
  }

  if (f.blocking) {
    pose.shoulderF = 2.15;
    pose.elbowF = 1.28;
    pose.shoulderB = 1.9;
    pose.elbowB = 1.15;
    pose.wristF = 0.2;
    pose.wristB = 0.15;
  }
  return pose;
}

/** Three per-fighter phase offsets so a crowd never sways in sync. */
function phases(f: Fighter): [number, number, number] {
  const s = f.seed;
  return [((s & 0xff) / 255) * 6.283, (((s >>> 8) & 0xff) / 255) * 6.283, (((s >>> 16) & 0xff) / 255) * 6.283];
}

/** Target torso angle: a slow drunken sway plus lagging, overshooting lean into motion. */
function drunkLean(f: Fighter, vx: number): number {
  const [a1, a2, a3] = phases(f);
  const t = f.clock;
  const moving = Math.abs(f.lastInput.moveX) > 0.1;
  const amp = (moving ? 1.7 : 1) * (f.dizzy > 0 ? 2.1 : 1);
  const freq = moving ? 1.35 : 1;
  let sway = amp * (0.1 * Math.sin(t * 1.3 * freq + a1) + 0.06 * Math.sin(t * 2.3 * freq + a2) + 0.03 * Math.sin(t * 3.7 * freq + a3));
  if (!f.grounded) sway *= 0.4;
  // Upper body trails on a start and keeps going on a stop.
  const lean = clamp(-0.05 * f.laggedVx + 0.045 * (vx - f.laggedVx), -0.38, 0.38);
  const lunge = f.attack === 'punch' ? -f.facing * 0.2 : 0;
  return sway + lean + lunge;
}

/** Wobbly stand-up target: big lazy circles that settle as the dizziness wears off. */
function wobbleTarget(f: Fighter): number {
  const [a1] = phases(f);
  const amp = 0.15 + Math.min(1, f.dizzy) * 0.25;
  return amp * Math.sin(f.clock * 5.2 + a1);
}

/** Height of whatever the fighter is standing over, so platforms feel like the floor. */
function probeGround(f: Fighter): number {
  const hip = f.bodies.torso.getWorldPoint({ x: 0, y: -TORSO.hy });
  let best = f.groundY;
  let found = false;
  f.bodies.torso.getWorld().rayCast({ x: hip.x, y: hip.y }, { x: hip.x, y: hip.y - 1.4 }, (fixture, point, _normal, fraction) => {
    const data = fixture.getUserData() as UserData | null;
    if (!data || data.kind !== 'world') return -1;
    best = point.y;
    found = true;
    return fraction;
  });
  return found ? best : Math.min(f.groundY, hip.y - 2);
}

function toWorld(pose: CharacterPose, facing: 1 | -1): Record<JointName, number> {
  const s = facing;
  return {
    neck: 0,
    shoulderF: pose.shoulderF * s,
    elbowF: pose.elbowF * s,
    wristF: pose.wristF * s,
    shoulderB: pose.shoulderB * s,
    elbowB: pose.elbowB * s,
    wristB: pose.wristB * s,
    hipF: pose.hipF * s,
    kneeF: -pose.kneeF * s,
    ankleF: 0,
    hipB: pose.hipB * s,
    kneeB: -pose.kneeB * s,
    ankleB: 0,
  };
}

function aimDir(input: InputFrame): { x: number; y: number; angle: number } {
  const len = Math.hypot(input.aimX, input.aimY) || 1;
  const x = input.aimX / len;
  const y = input.aimY / len;
  return { x, y, angle: Math.atan2(y, x) };
}

function grabAim(
  origin: { x: number; y: number },
  other: Fighter,
  dir: { x: number; y: number },
): { x: number; y: number } | null {
  let best: { x: number; y: number; score: number } | null = null;
  for (const part of PARTS) {
    const p = other.bodies[part].getPosition();
    const dx = p.x - origin.x;
    const dy = p.y - origin.y;
    const dist = Math.hypot(dx, dy);
    const dot = (dx * dir.x + dy * dir.y) / (dist || 1);
    if (dist < LEN.upperArm + LEN.lowerArm + 0.45 && dot > -0.1) {
      const score = dist - dot * 0.25;
      if (!best || score < best.score) best = { x: p.x, y: p.y, score };
    }
  }
  return best ? { x: best.x, y: best.y } : null;
}

function limitsFor(name: JointName, facing: 1 | -1, open: boolean): [number, number] {
  if (name === 'neck') return [-0.85, 0.85];
  if (name === 'wristF' || name === 'wristB') return [-1.15, 1.15];
  if (name === 'ankleF' || name === 'ankleB') return [-0.95, 0.95];
  if (name === 'shoulderF' || name === 'shoulderB') return [-2.9, 2.9];
  if (name === 'hipF' || name === 'hipB') {
    if (open) return [-2.05, 2.05];
    return facing === 1 ? [-1.2, 2.05] : [-2.05, 1.2];
  }
  if (name === 'elbowF' || name === 'elbowB') {
    if (open) return [-2.6, 2.6];
    return facing === 1 ? [-0.25, 2.6] : [-2.6, 0.25];
  }
  if (open) return [-2.6, 2.6];
  return facing === 1 ? [-2.6, 0.3] : [-0.3, 2.6];
}

function torqueFor(name: JointName, f: Fighter, params: BalanceParams, kicking: boolean): number {
  const mute = f.balanceMute > 0 ? 0.18 : 1;
  if (name === 'neck') return (f.hitStun > 0 || f.dizzy > 0 ? 1.2 : 2.8) * mute;
  if (name === 'wristF' || name === 'wristB') return 8 * mute;
  if (name === 'ankleF' || name === 'ankleB') return params.legTorque * 0.48 * mute;
  if (name === 'hipF' || name === 'hipB' || name === 'kneeF' || name === 'kneeB') {
    let torque = f.state === 'getup' ? params.getUpTorque : params.legTorque;
    if (kicking && (name === 'hipB' || name === 'kneeB')) torque *= 1.35;
    if (f.attack === 'kick' && (name === 'hipF' || name === 'kneeF')) torque *= 1.75;
    return torque * mute;
  }
  // Arms are floppy noodles until they have a job to do.
  let torque = params.armTorque;
  if (f.attack === 'punch' && (name === 'shoulderF' || name === 'elbowF')) torque = Math.max(torque * 5, 70);
  if (f.blocking) torque = Math.max(torque * 3.5, 50);
  if (f.grab || f.grabIntent > 0) torque = Math.max(torque * 3, 45);
  return torque * mute;
}

function driveJoint(joint: RevoluteJoint, target: number, torque: number, gain: number, maxSpeed: number): void {
  if (torque <= 0.01) {
    joint.setMotorSpeed(0);
    joint.setMaxMotorTorque(0);
    return;
  }
  const err = normalizeAngle(target - joint.getJointAngle());
  joint.setMotorSpeed(clamp(err * gain, -maxSpeed, maxSpeed));
  joint.setMaxMotorTorque(torque * clamp(0.45 + Math.abs(err) * 2.2, 0.45, 1));
}
