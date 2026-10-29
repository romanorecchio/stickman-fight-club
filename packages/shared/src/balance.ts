import { clamp } from './math.js';

export interface BalanceParams {
  gravity: number;
  walkSpeed: number;
  sprintSpeed: number;
  crouchSpeed: number;
  airControl: number;
  jumpSpeed: number;
  uprightKp: number;
  uprightKd: number;
  maxUprightTorque: number;
  speedKp: number;
  maxBalanceForce: number;
  stumbleAngle: number;
  fallAngle: number;
  legTorque: number;
  armTorque: number;
  getUpTorque: number;
  motorGain: number;
  maxMotorSpeed: number;
  attackMotorSpeed: number;
  footFriction: number;
  knockbackScale: number;
  damageScale: number;
  throwImpulse: number;
  grabDuration: number;
  struggleRate: number;
  poseSmoothing: number;
}

export const DEFAULT_BALANCE: BalanceParams = {
  gravity: -30,
  walkSpeed: 3.6,
  sprintSpeed: 6.4,
  crouchSpeed: 1.55,
  airControl: 0.45,
  jumpSpeed: 11.2,
  uprightKp: 420,
  uprightKd: 48,
  maxUprightTorque: 360,
  speedKp: 62,
  maxBalanceForce: 220,
  stumbleAngle: 0.62,
  fallAngle: 1.08,
  legTorque: 130,
  armTorque: 36,
  getUpTorque: 140,
  motorGain: 13,
  maxMotorSpeed: 9,
  attackMotorSpeed: 14,
  footFriction: 1.15,
  knockbackScale: 1,
  damageScale: 1,
  throwImpulse: 54,
  grabDuration: 2.2,
  struggleRate: 0.42,
  poseSmoothing: 12,
};

export function sanitizeBalance(input: BalanceParams): BalanceParams {
  const p = { ...input };
  p.gravity = clamp(p.gravity, -60, -8);
  p.walkSpeed = clamp(p.walkSpeed, 0.4, 10);
  p.sprintSpeed = clamp(Math.max(p.sprintSpeed, p.walkSpeed), 0.6, 14);
  p.crouchSpeed = clamp(p.crouchSpeed, 0.2, 6);
  p.airControl = clamp(p.airControl, 0, 1);
  p.jumpSpeed = clamp(p.jumpSpeed, 2, 18);
  p.uprightKp = clamp(p.uprightKp, 10, 800);
  p.uprightKd = clamp(p.uprightKd, 0, 120);
  p.maxUprightTorque = clamp(p.maxUprightTorque, 10, 500);
  p.speedKp = clamp(p.speedKp, 1, 300);
  p.maxBalanceForce = clamp(p.maxBalanceForce, 10, 800);
  p.fallAngle = clamp(p.fallAngle, 0.45, 2.2);
  p.stumbleAngle = clamp(p.stumbleAngle, 0.2, p.fallAngle - 0.08);
  p.legTorque = clamp(p.legTorque, 5, 300);
  p.armTorque = clamp(p.armTorque, 2, 200);
  p.getUpTorque = clamp(p.getUpTorque, 10, 400);
  p.motorGain = clamp(p.motorGain, 1, 40);
  p.maxMotorSpeed = clamp(p.maxMotorSpeed, 1, 30);
  p.attackMotorSpeed = clamp(p.attackMotorSpeed, 2, 40);
  p.footFriction = clamp(p.footFriction, 0.05, 2);
  p.knockbackScale = clamp(p.knockbackScale, 0, 3);
  p.damageScale = clamp(p.damageScale, 0, 3);
  p.throwImpulse = clamp(p.throwImpulse, 0, 120);
  p.grabDuration = clamp(p.grabDuration, 0.3, 6);
  p.struggleRate = clamp(p.struggleRate, 0.05, 3);
  p.poseSmoothing = clamp(p.poseSmoothing, 2, 40);
  return p;
}
