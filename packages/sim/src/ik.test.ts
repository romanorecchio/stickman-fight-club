import { describe, expect, it } from 'vitest';
import { normalizeAngle } from '@sfc/shared';
import { bendSign, solveTwoLink } from './ik.js';

describe('two-link IK', () => {
  it('hangs straight down at joint angle 0', () => {
    const solved = solveTwoLink({ x: 0, y: 0 }, { x: 0, y: -2 }, 0, 1, 1, -1);
    expect(solved.joint1).toBeCloseTo(0, 2);
    expect(Math.abs(solved.joint2)).toBeLessThan(0.05);
  });

  it('points a straight limb to the right at half pi', () => {
    const solved = solveTwoLink({ x: 0, y: 0 }, { x: 2, y: 0 }, 0, 1, 1, -1);
    expect(solved.joint1).toBeCloseTo(Math.PI / 2, 2);
    expect(Math.abs(solved.joint2)).toBeLessThan(0.05);
  });

  it('droops the elbow below a rightward reach', () => {
    const solved = solveTwoLink({ x: 0, y: 0 }, { x: 1, y: 0 }, 0, 1, 1, bendSign(0, false));
    expect(solved.joint2).toBeGreaterThan(0.2);
    const midY = Math.sin(solved.joint1 - Math.PI / 2);
    expect(midY).toBeLessThan(0);
  });

  it('keeps angles in range', () => {
    const solved = solveTwoLink({ x: 0, y: 1 }, { x: -0.4, y: 2.2 }, 0.4, 0.32, 0.29, 1);
    expect(Math.abs(normalizeAngle(solved.joint1))).toBeLessThanOrEqual(Math.PI + 1e-6);
    expect(Math.abs(normalizeAngle(solved.joint2))).toBeLessThanOrEqual(Math.PI + 1e-6);
  });
});
