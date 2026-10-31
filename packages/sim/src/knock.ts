import { PARTS, clamp } from '@sfc/shared';
import type { Fighter } from './fighter.js';

/**
 * Throw the whole ragdoll at once: every part gets the same velocity change plus a
 * rigid spin about the body's center of mass. Pushing only the torso makes the joints
 * stretch and snap back (the old "rubber skeleton" jank); this keeps the skeleton intact
 * while the body cartwheels away.
 */
export function launch(f: Fighter, dvx: number, dvy: number, spin: number, cap = 17): void {
  const mag = Math.hypot(dvx, dvy);
  if (mag > cap) {
    dvx *= cap / mag;
    dvy *= cap / mag;
  }
  spin = clamp(spin, -16, 16);
  let mass = 0;
  let cx = 0;
  let cy = 0;
  for (const part of PARTS) {
    const body = f.bodies[part];
    const m = body.getMass();
    const c = body.getWorldCenter();
    mass += m;
    cx += c.x * m;
    cy += c.y * m;
  }
  if (mass <= 0) return;
  cx /= mass;
  cy /= mass;
  for (const part of PARTS) {
    const body = f.bodies[part];
    const c = body.getWorldCenter();
    const v = body.getLinearVelocity();
    // Rigid spin: v = w x r.
    const rx = c.x - cx;
    const ry = c.y - cy;
    body.setLinearVelocity({ x: v.x + dvx - spin * ry, y: v.y + dvy + spin * rx });
    body.setAngularVelocity(body.getAngularVelocity() + spin);
    body.setAwake(true);
  }
}

/** Go limp for a while. The longer the knockdown, the dizzier the stand-up. */
export function knockDown(f: Fighter, seconds: number): void {
  if (f.state === 'ko') return;
  const already = f.state === 'fallen' ? f.downFor - f.stateTime : 0;
  f.state = 'fallen';
  f.stateTime = 0;
  f.downFor = Math.max(already, clamp(seconds, 0.3, 2.2));
  f.dizzy = Math.max(f.dizzy, f.downFor + 1.1);
  f.balanceMute = Math.max(f.balanceMute, 0.4);
  f.attack = null;
  f.strike = null;
}
