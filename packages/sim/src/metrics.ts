import type { PartName } from '@sfc/shared';

export interface BoxSize {
  hx: number;
  hy: number;
}

export const TORSO: BoxSize = { hx: 0.17, hy: 0.3 };
export const HEAD = { r: 0.19 };
export const UPPER_ARM: BoxSize = { hx: 0.05, hy: 0.16 };
export const LOWER_ARM: BoxSize = { hx: 0.045, hy: 0.145 };
export const HAND = { r: 0.075 };
export const UPPER_LEG: BoxSize = { hx: 0.07, hy: 0.19 };
export const LOWER_LEG: BoxSize = { hx: 0.058, hy: 0.175 };
export const FOOT: BoxSize = { hx: 0.13, hy: 0.045 };

export const LEN = {
  upperArm: UPPER_ARM.hy * 2,
  lowerArm: LOWER_ARM.hy * 2,
  upperLeg: UPPER_LEG.hy * 2,
  lowerLeg: LOWER_LEG.hy * 2,
};

/** Straight-leg stack. Foot bottom sits on y = 0. Joint anchors coincide. */
export function layoutCharacter(x: number): Record<PartName, { x: number; y: number }> {
  const footCenter = FOOT.hy;
  const ankleY = footCenter + FOOT.hy;
  const kneeY = ankleY + LOWER_LEG.hy * 2;
  const hipY = kneeY + UPPER_LEG.hy * 2;
  const torsoCenter = hipY + TORSO.hy;
  const neckY = torsoCenter + TORSO.hy;
  const headCenter = neckY + HEAD.r;
  const shoulderY = torsoCenter + TORSO.hy * 0.5;
  const elbowY = shoulderY - UPPER_ARM.hy * 2;
  const wristY = elbowY - LOWER_ARM.hy * 2;
  const handCenter = wristY - HAND.r;
  return {
    torso: { x, y: torsoCenter },
    head: { x, y: headCenter },
    upperArmF: { x, y: (shoulderY + elbowY) / 2 },
    upperArmB: { x, y: (shoulderY + elbowY) / 2 },
    lowerArmF: { x, y: (elbowY + wristY) / 2 },
    lowerArmB: { x, y: (elbowY + wristY) / 2 },
    handF: { x, y: handCenter },
    handB: { x, y: handCenter },
    upperLegF: { x, y: (hipY + kneeY) / 2 },
    upperLegB: { x, y: (hipY + kneeY) / 2 },
    lowerLegF: { x, y: (kneeY + ankleY) / 2 },
    lowerLegB: { x, y: (kneeY + ankleY) / 2 },
    footF: { x, y: footCenter },
    footB: { x, y: footCenter },
  };
}

export const DENSITY: Record<PartName, number> = {
  head: 7.5,
  torso: 16,
  upperArmF: 10,
  upperArmB: 10,
  lowerArmF: 10,
  lowerArmB: 10,
  handF: 13,
  handB: 13,
  upperLegF: 14,
  upperLegB: 14,
  lowerLegF: 12,
  lowerLegB: 12,
  footF: 15,
  footB: 15,
};

export const ARENA = {
  minX: -12,
  maxX: 12,
  minY: -1,
  maxY: 9,
  spawnPlayer: -1.6,
  spawnDummy: 2.05,
};

/** Ground positions clear of platforms and the crate. */
export const SPAWN_XS = [-8.8, -3.3, -1.6, 0.6, 2.05, 3.5, 8.5, 9.8];

/** Pick a free spawn near the group, and never on top of another fighter. */
export function chooseSpawn(occupied: number[], spots: readonly number[] = SPAWN_XS): number {
  if (occupied.length === 0) return spots.includes(-1.6) ? -1.6 : (spots[Math.floor(spots.length / 2)] ?? -1.6);
  const mean = occupied.reduce((sum, value) => sum + value, 0) / occupied.length;
  const ranked = spots.map((x) => ({
    x,
    gap: Math.min(...occupied.map((other) => Math.abs(x - other))),
  })).sort((a, b) => b.gap - a.gap);
  const safe = ranked.filter((item) => item.gap >= 1.2);
  const pool = safe.length > 0 ? safe : ranked;
  pool.sort((a, b) => Math.abs(a.x - mean) - Math.abs(b.x - mean));
  return pool[0]?.x ?? spots[0] ?? -1.6;
}
