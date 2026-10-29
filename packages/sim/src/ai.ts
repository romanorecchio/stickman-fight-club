import type { InputFrame } from '@sfc/shared';
import type { Fighter } from './fighter.js';

export function thinkDummy(
  tick: number,
  dummy: Fighter,
  player: Fighter,
  rng: () => number,
): InputFrame {
  const dp = dummy.bodies.torso.getPosition();
  const pp = player.bodies.torso.getPosition();
  const dx = pp.x - dp.x;
  const dy = pp.y - dp.y;
  const dist = Math.abs(dx);
  let moveX = 0;
  if (dist > 1.08) moveX = dx > 0 ? 1 : -1;
  const sprint = dist > 3.8;
  const t = tick % 100;
  const roll = rng();
  const attacking = player.attack !== null || player.strike !== null;
  let punch = false;
  let kick = false;
  let block = false;
  let jump = false;
  if (dummy.state !== 'fallen' && dummy.state !== 'ko' && dummy.state !== 'getup') {
    if (dist < 1.28 && t === 16) punch = true;
    if (dist < 1.45 && t === 58) kick = true;
    if (dist < 1.2 && attacking && roll < 0.6) block = true;
    if (dy > 1.2 && dist < 2.3 && t === 36) jump = true;
  }
  return {
    seq: tick,
    moveX,
    jump,
    crouch: false,
    sprint,
    punch,
    kick,
    block,
    grab: false,
    throw: false,
    aimX: dx === 0 ? -dummy.facing : dx,
    aimY: dy + 0.12,
  };
}
