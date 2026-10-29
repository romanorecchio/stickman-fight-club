import { clamp, normalizeAngle } from '@sfc/shared';

export interface LinkSolve {
  joint1: number;
  joint2: number;
}

/**
 * Two-link reach. Body angle 0 means the limb's local +Y is world up, so a
 * straight hang (target below the origin) is joint angle 0.
 * `bendSign` +1 offsets the mid-joint counterclockwise from the target line.
 */
export function solveTwoLink(
  origin: { x: number; y: number },
  target: { x: number; y: number },
  parentAngle: number,
  l1: number,
  l2: number,
  bendSign: number,
): LinkSolve {
  let dx = target.x - origin.x;
  let dy = target.y - origin.y;
  let dist = Math.hypot(dx, dy);
  if (dist < 1e-4) {
    dx = 1e-4;
    dy = 0;
    dist = 1e-4;
  }
  if (dist >= l1 + l2 - 1e-3) {
    const upperDir = Math.atan2(dy, dx);
    const upperAngle = upperDir + Math.PI / 2;
    return { joint1: normalizeAngle(upperAngle - parentAngle), joint2: 0 };
  }
  const maxD = l1 + l2 - 0.004;
  const minD = Math.abs(l1 - l2) + 0.012;
  const clamped = clamp(dist, minD, maxD);
  const scale = clamped / dist;
  dx *= scale;
  dy *= scale;
  dist = clamped;

  const dir = Math.atan2(dy, dx);
  const cosA = clamp((l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist), -1, 1);
  const alpha = Math.acos(cosA);
  const upperDir = dir + alpha * bendSign;
  const ex = origin.x + Math.cos(upperDir) * l1;
  const ey = origin.y + Math.sin(upperDir) * l1;
  const lowerDir = Math.atan2(origin.y + dy - ey, origin.x + dx - ex);
  const upperAngle = upperDir + Math.PI / 2;
  const lowerAngle = lowerDir + Math.PI / 2;
  return {
    joint1: normalizeAngle(upperAngle - parentAngle),
    joint2: normalizeAngle(lowerAngle - upperAngle),
  };
}

/** +1 raises the mid-joint when that rotation increases world Y. */
export function bendSign(dir: number, preferUp: boolean): number {
  const positiveRaises = Math.cos(dir) >= 0;
  const signUp = positiveRaises ? 1 : -1;
  return preferUp ? signUp : -signUp;
}
