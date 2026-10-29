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
import type { Fighter } from './fighter.js';
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

  if (input.kick && f.cooldownKick <= 0 && canAct) {
    beginStrike(f, 'kick', time);
  } else if (input.punch && f.cooldownPunch <= 0 && canAct && f.attack !== 'kick') {
    beginStrike(f, 'punch', time);
  }

  if (input.grab && !f.prevGrab && canAct && !f.grab && !f.heldBy) {
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
    const getupBoost = f.state === 'getup' ? 1.45 : 1;
    const held = f.heldBy ? 0.6 : 1;
    let torque = -angle * params.uprightKp * mute * getupBoost * held - angVel * params.uprightKd;
    torque = clamp(torque, -params.maxUprightTorque, params.maxUprightTorque);
    torso.applyTorque(torque, true);
  }

  let targetVx = 0;
  if (!limp && f.state !== 'getup') {
    const speed = (input.crouch || f.state === 'crouch' ? params.crouchSpeed : input.sprint ? params.sprintSpeed : params.walkSpeed) * f.moveScale;
    targetVx = clamp(input.moveX, -1, 1) * speed;
    if (f.blocking) targetVx *= 0.55;
    if (f.attack === 'kick') targetVx *= 0.45;
  }
  const accel = !f.grounded ? params.airControl : limp ? 0 : f.balanceMute > 0 ? 0.15 : f.heldBy ? 0.45 : 1;
  const fx = clamp((targetVx - vel.x) * params.speedKp * accel, -params.maxBalanceForce, params.maxBalanceForce);
  if (Math.abs(fx) > 0.5) torso.applyForce({ x: fx, y: 0 }, hip, true);

  if (f.grounded && f.balanceMute <= 0 && (f.state === 'idle' || f.state === 'walk' || f.state === 'sprint' || f.state === 'stumble')) {
    const err = 0.8 - hip.y;
    if (err > 0.03) torso.applyForceToCenter({ x: 0, y: clamp(err * 520, 0, 280) }, true);
  }
  if (f.grounded && f.state === 'crouch') {
    const err = 0.48 - hip.y;
    if (err < -0.02) torso.applyForceToCenter({ x: 0, y: clamp(err * 320, -200, 0) }, true);
  }
  if (f.state === 'getup' && f.stateTime > 0.28 && f.grounded && hip.y < 0.74) {
    torso.applyForceToCenter({ x: 0, y: clamp((0.8 - hip.y) * 220, 0, 210) }, true);
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
    for (const name of JOINTS) {
      f.joints[name].setMotorSpeed(0);
      f.joints[name].setMaxMotorTorque(0);
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
  const hipY = f.bodies.torso.getWorldPoint({ x: 0, y: -TORSO.hy }).y;
  const abs = Math.abs(angle);

  if (f.state === 'ko') {
    f.stateTime += dt;
    return;
  }

  if (f.state === 'fallen') {
    f.stateTime += dt;
    const vel = f.bodies.torso.getLinearVelocity();
    const calm = Math.abs(angVel) < 2.4 && Math.hypot(vel.x, vel.y) < 2.1;
    if ((f.stateTime > 0.42 && calm) || f.stateTime > 1.05) {
      f.state = 'getup';
      f.stateTime = 0;
      f.attack = null;
      f.strike = null;
    }
    return;
  }

  if (f.state === 'getup') {
    f.stateTime += dt;
    const up = abs < 0.38 && hipY > 0.66 && f.grounded;
    if (up && f.stateTime > 0.3) {
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

  if ((f.state === 'walk' || f.state === 'sprint') && f.grounded) {
    f.phase += dt * (f.state === 'sprint' ? 10.6 : 7.6);
  } else {
    f.phase = normalizeAngle(f.phase) * Math.exp(-7 * dt);
  }
}

function desiredWorld(f: Fighter, input: InputFrame, other: Fighter | null, torsoAngle: number): Record<JointName, number> {
  const pose = characterPose(f, input);
  const world = toWorld(pose, f.facing);
  const torso = f.bodies.torso;
  const dir = aimDir(input);
  if (f.state !== 'getup') {
    const lean = normalizeAngle(torsoAngle);
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

  world.neck = clamp(normalizeAngle(f.facing * 0.05 - torso.getAngle()), -0.8, 0.8);
  world.ankleF = clamp(-f.bodies.lowerLegF.getAngle(), -0.9, 0.9);
  world.ankleB = clamp(-f.bodies.lowerLegB.getAngle(), -0.9, 0.9);
  return world;
}

function characterPose(f: Fighter, input: InputFrame): CharacterPose {
  if (f.state === 'getup') {
    const early = f.stateTime < 0.42;
    return {
      shoulderF: early ? 0.55 : 0.9,
      elbowF: early ? 0.35 : 0.45,
      wristF: 0.1,
      shoulderB: early ? 0.35 : 0.7,
      elbowB: 0.3,
      wristB: 0.1,
      hipF: early ? 0.85 : 0.22,
      kneeF: early ? 2.05 : 0.35,
      hipB: early ? 0.7 : 0.12,
      kneeB: early ? 2.0 : 0.3,
    };
  }

  if (f.state === 'air' || !f.grounded) {
    const rising = f.vyPrev > 0.4;
    return {
      shoulderF: rising ? 1.55 : 1.05,
      elbowF: rising ? 0.55 : 0.35,
      wristF: 0.1,
      shoulderB: rising ? 1.25 : 0.75,
      elbowB: 0.4,
      wristB: 0.1,
      hipF: rising ? 0.4 : 0.12,
      kneeF: rising ? 1.2 : 0.22,
      hipB: rising ? 0.25 : 0.05,
      kneeB: rising ? 1.05 : 0.18,
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

  const moving = f.state === 'walk' || f.state === 'sprint';
  const sprint = f.state === 'sprint';
  const sF = Math.sin(f.phase);
  const sB = -sF;
  const stride = (sprint ? 0.48 : 0.34) * (moving ? 1 : 0);
  const arm = moving ? (sprint ? 0.5 : 0.36) : 0;
  const lead = moving ? clamp(f.bodies.torso.getLinearVelocity().x * f.facing * 0.07, -0.28, 0.28) : 0;
  const pose: CharacterPose = {
    shoulderF: 0.22 - sF * arm,
    elbowF: 0.38,
    wristF: 0.12,
    shoulderB: 0.12 - sB * arm * 0.85,
    elbowB: 0.32,
    wristB: 0.1,
    hipF: sF * stride + lead,
    kneeF: 0.1 + Math.max(0, sF) * (sprint ? 1.05 : 0.85) * (moving ? 1 : 0),
    hipB: sB * stride + lead,
    kneeB: 0.1 + Math.max(0, sB) * (sprint ? 1.05 : 0.85) * (moving ? 1 : 0),
  };

  if (f.state === 'stumble') {
    pose.shoulderF = 1.45;
    pose.elbowF = 0.35;
    pose.shoulderB = -0.55;
    pose.elbowB = 0.3;
    pose.kneeF = Math.max(pose.kneeF, 0.4);
    pose.kneeB = Math.max(pose.kneeB, 0.4);
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
  if (name === 'neck') return (f.hitStun > 0 ? 6 : 22) * mute;
  if (name === 'wristF' || name === 'wristB') return 8 * mute;
  if (name === 'ankleF' || name === 'ankleB') return params.legTorque * 0.48 * mute;
  if (name === 'hipF' || name === 'hipB' || name === 'kneeF' || name === 'kneeB') {
    let torque = f.state === 'getup' ? params.getUpTorque : params.legTorque;
    if (kicking && (name === 'hipB' || name === 'kneeB')) torque *= 1.35;
    if (f.attack === 'kick' && (name === 'hipF' || name === 'kneeF')) torque *= 1.75;
    return torque * mute;
  }
  let torque = params.armTorque;
    if (f.attack === 'punch' && (name === 'shoulderF' || name === 'elbowF')) torque *= 2;
  if (f.blocking) torque *= 1.45;
  if (f.grab || f.grabIntent > 0) torque *= 1.35;
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
