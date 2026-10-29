import { Box, World, type Body } from 'planck';
import { CATEGORY_FIGHTER, CATEGORY_WORLD, type MapDef, type SolidKind, type SolidSnapshot } from '@sfc/shared';
import type { UserData } from './fighter.js';

export interface LiveSolid {
  body: Body | null;
  x: number;
  y: number;
  hx: number;
  hy: number;
  kind: SolidKind;
  baseX: number;
  baseY: number;
  move: { axis: 'x' | 'y'; amp: number; period: number; phase: number } | null;
  hp: number | null;
  barrel: boolean;
  dead: boolean;
}

export interface Level {
  solids: LiveSolid[];
}

export function buildLevel(world: World, map: MapDef): Level {
  const solids: LiveSolid[] = map.solids.map((def) => {
    const body = world.createBody({ type: def.move ? 'kinematic' : 'static', position: { x: def.x, y: def.y } });
    const userData: UserData = { kind: 'world', surface: def.kind === 'barrel' ? 'crate' : def.kind };
    body.setUserData(userData);
    body.createFixture(new Box(def.hx, def.hy), {
      friction: def.kind === 'wall' || def.kind === 'rope' ? 0.2 : 1,
      restitution: 0.02,
      filterCategoryBits: CATEGORY_WORLD,
      filterMaskBits: CATEGORY_FIGHTER,
      userData,
    });
    return {
      body,
      x: def.x,
      y: def.y,
      hx: def.hx,
      hy: def.hy,
      kind: def.kind,
      baseX: def.x,
      baseY: def.y,
      move: def.move ?? null,
      hp: def.hp ?? null,
      barrel: def.barrel === true,
      dead: false,
    };
  });
  return { solids };
}

export function tickLevel(level: Level, time: number): void {
  for (const solid of level.solids) {
    if (!solid.move || !solid.body || solid.dead) continue;
    const w = (Math.PI * 2) / solid.move.period;
    const off = Math.sin(time * w + solid.move.phase) * solid.move.amp;
    const x = solid.baseX + (solid.move.axis === 'x' ? off : 0);
    const y = solid.baseY + (solid.move.axis === 'y' ? off : 0);
    const speed = Math.cos(time * w + solid.move.phase) * solid.move.amp * w;
    solid.body.setTransform({ x, y }, 0);
    solid.body.setLinearVelocity({
      x: solid.move.axis === 'x' ? speed : 0,
      y: solid.move.axis === 'y' ? speed : 0,
    });
    solid.x = x;
    solid.y = y;
  }
}

export function solidSnaps(level: Level): SolidSnapshot[] {
  return level.solids
    .filter((solid) => !solid.dead)
    .map((solid) => ({ x: solid.x, y: solid.y, hx: solid.hx, hy: solid.hy, kind: solid.kind }));
}
