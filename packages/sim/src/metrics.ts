import type { PartName } from '@sfc/shared';

export interface BoxSize {
  hx: number;
  hy: number;
}

export const TORSO: BoxSize = { hx: 0.17, hy: 0.3 };
export const HEAD = { r: 0.155 };
export const UPPER_ARM: BoxSize = { hx: 0.05, hy: 0.16 };
export const LOWER_ARM: BoxSize = { hx: 0.045, hy: 0.145 };
export const HAND = { r: 0.065 };
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
  head: 10,
  torso: 16,
  upperArmF: 10,
  upperArmB: 10,
  lowerArmF: 10,
  lowerArmB: 10,
  handF: 7,
  handB: 7,
  upperLegF: 14,
  upperLegB: 14,
  lowerLegF: 12,
  lowerLegB: 12,
  footF: 12,
  footB: 12,
};

export const ARENA = {
  minX: -12,
  maxX: 12,
  minY: -1,
  maxY: 9,
  spawnPlayer: -1.6,
  spawnDummy: 2.05,
};
