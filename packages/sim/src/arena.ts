import { Box, World } from 'planck';
import { CATEGORY_FIGHTER, CATEGORY_WORLD, type SolidKind, type SolidSnapshot } from '@sfc/shared';
import type { UserData } from './fighter.js';

export function buildArena(world: World): SolidSnapshot[] {
  const solids: SolidSnapshot[] = [];
  const add = (x: number, y: number, hx: number, hy: number, kind: SolidKind) => {
    const body = world.createBody({ type: 'static', position: { x, y } });
    const userData: UserData = { kind: 'world', surface: kind };
    body.setUserData(userData);
    body.createFixture(new Box(hx, hy), {
      friction: kind === 'wall' ? 0.18 : 1,
      restitution: 0.02,
      filterCategoryBits: CATEGORY_WORLD,
      filterMaskBits: CATEGORY_FIGHTER,
      userData,
    });
    solids.push({ x, y, hx, hy, kind });
  };

  add(0, -0.5, 12.2, 0.5, 'ground');
  add(-12.35, 5, 0.4, 7, 'wall');
  add(12.35, 5, 0.4, 7, 'wall');
  add(-6.05, 1.38, 1.5, 0.12, 'platform');
  add(5.55, 1.58, 1.45, 0.12, 'platform');
  add(0, 2.78, 1.3, 0.12, 'platform');
  add(7.7, 0.38, 0.46, 0.38, 'crate');
  return solids;
}
