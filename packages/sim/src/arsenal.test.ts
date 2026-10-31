import { describe, expect, it } from 'vitest';
import { FIXED_DT, MAPS, WEAPONS, emptyInput, type InputFrame } from '@sfc/shared';
import { Simulation } from './simulation.js';

const IDS = [
  'bat', 'sword', 'hammer', 'knife', 'crowbar', 'spear', 'mallet', 'shield',
  'pistol', 'revolver', 'shotgun', 'ar', 'sniper', 'smg',
  'grenade', 'rocket', 'mine', 'sticky', 'dynamite',
  'pan', 'glove', 'gravity', 'chicken', 'energy', 'fish', 'banana', 'club',
];

function step(sim: Simulation, ids: string[], seconds: number, patch: (id: string) => Partial<InputFrame> = () => ({})): void {
  const frames = Math.max(1, Math.round(seconds / FIXED_DT));
  for (let i = 0; i < frames; i += 1) {
    const inputs = new Map<string, InputFrame>();
    for (const id of ids) inputs.set(id, { ...emptyInput(i + 1), ...patch(id) });
    sim.stepAll(FIXED_DT, inputs);
  }
}

describe('weapons and maps', () => {
  it('includes every weapon and six maps', () => {
    const ids = WEAPONS.map((weapon) => weapon.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of IDS) expect(ids).toContain(id);
    expect(MAPS.map((map) => map.id)).toEqual(['classic', 'rooftop', 'lava', 'destruction', 'sky', 'boxing']);
  });

  it('a pistol round hurts the other fighter and spends ammo', () => {
    const sim = new Simulation({ roster: 'empty', ai: false, seed: 4, spawnProtect: 0 });
    sim.addFighter('a', 'Ada', 0);
    sim.addFighter('b', 'Bea', 1);
    sim.giveWeapon('a', 'pistol');
    step(sim, ['a', 'b'], 0.15);
    const ammoBefore = sim.getSnapshot('a').fighters.find((fighter) => fighter.id === 'a')?.ammo ?? 0;
    const aim = () => {
      const rows = sim.summaries();
      const ada = rows.find((row) => row.id === 'a')!;
      const bea = rows.find((row) => row.id === 'b')!;
      return { aimX: bea.x - ada.x, aimY: bea.y - ada.y };
    };
    step(sim, ['a', 'b'], 0.45, (id) => (id === 'a' ? { punch: true, ...aim() } : aim()));
    const after = sim.getSnapshot('a');
    const bea = after.fighters.find((fighter) => fighter.id === 'b')!;
    const ada = after.fighters.find((fighter) => fighter.id === 'a')!;
    expect(bea.hp).toBeLessThan(100);
    expect(ada.ammo).toBeLessThan(ammoBefore);
    expect(sim.getStability().nanEvents).toBe(0);
    expect(sim.hurtBy('b')).toBe('a');
  });

  it('a grenade becomes a projectile and a mine detonates on the other fighter', () => {
    const thrown = new Simulation({ roster: 'empty', ai: false, seed: 5, spawnProtect: 0 });
    thrown.addFighter('a', 'Ada', 0);
    thrown.addFighter('b', 'Bea', 1);
    thrown.giveWeapon('a', 'grenade');
    step(thrown, ['a', 'b'], 0.05, (id) => (id === 'a' ? { punch: true, aimX: 1, aimY: 0.4 } : {}));
    expect(thrown.getSnapshot('a').projectiles.some((shot) => shot.weapon === 'grenade')).toBe(true);

    const sim = new Simulation({ roster: 'empty', ai: false, seed: 9, spawnProtect: 0 });
    sim.addFighter('a', 'Ada', 0);
    sim.addFighter('b', 'Bea', 1);
    sim.giveWeapon('a', 'mine');
    step(sim, ['a', 'b'], 0.08, (id) => (id === 'a' ? { punch: true } : {}));
    const ada = sim.summaries().find((row) => row.id === 'a')!;
    const bea = sim.summaries().find((row) => row.id === 'b')!;
    sim.debugShift('b', ada.x - bea.x, 0);
    step(sim, ['a', 'b'], 1);
    expect(sim.summaries().find((row) => row.id === 'b')!.hp).toBeLessThan(100);
    const stability = sim.getStability();
    expect(stability.nanEvents).toBe(0);
    expect(stability.maxJointSeparation).toBeLessThan(0.45);
  });

  it('picking up a weapon equips it', () => {
    const sim = new Simulation({ roster: 'empty', ai: false, seed: 6, spawnProtect: 0 });
    sim.addFighter('a', 'Ada', 0);
    sim.deployWeapons(true, { melee: true, firearm: true, explosive: true, novelty: true });
    expect(sim.pickupCount()).toBeGreaterThan(0);
    const pickup = sim.getSnapshot('a').pickups[0]!;
    const here = sim.summaries()[0]!;
    sim.debugShift('a', pickup.x - here.x, 0);
    step(sim, ['a'], 0.2, () => ({ pickup: true }));
    expect(sim.weaponOf('a')).toBe(pickup.weapon);
  });

  it('the one grab button picks a weapon up and, pressed again, drops it', () => {
    const sim = new Simulation({ roster: 'empty', ai: false, seed: 6, spawnProtect: 0 });
    sim.addFighter('a', 'Ada', 0);
    sim.deployWeapons(true, { melee: true, firearm: true, explosive: true, novelty: true });
    const pickup = sim.getSnapshot('a').pickups[0]!;
    const here = sim.summaries()[0]!;
    sim.debugShift('a', pickup.x - here.x, 0);
    step(sim, ['a'], 0.1, () => ({ grab: true }));
    step(sim, ['a'], 0.3);
    expect(sim.weaponOf('a')).toBe(pickup.weapon);
    step(sim, ['a'], 0.4, () => ({ punch: true }));
    step(sim, ['a'], 0.3);
    expect(sim.getStability().nanEvents).toBe(0);
    const now = sim.summaries()[0]!;
    const spots = [-8, -6, -4, -2, 0, 2, 4, 6, 8];
    const items = sim.getSnapshot('a').pickups;
    const clear = spots.find((x) => items.every((item) => Math.abs(item.x - x) > 2)) ?? 0;
    sim.debugShift('a', clear - now.x, 0);
    step(sim, ['a'], 0.5);
    step(sim, ['a'], 0.1, () => ({ grab: true }));
    step(sim, ['a'], 0.3);
    expect(sim.weaponOf('a')).toBeFalsy();
  });

  it('lava under a gap respawns a fighter who falls in', () => {
    const sim = new Simulation({ roster: 'empty', ai: false, mapId: 'lava', seed: 7 });
    sim.addFighter('a', 'Ada', 0);
    step(sim, ['a'], 0.2);
    const here = sim.summaries()[0]!;
    sim.debugShift('a', -here.x, 0);
    step(sim, ['a'], 2);
    expect(sim.respawns).toBeGreaterThan(0);
    expect(sim.getStability().nanEvents).toBe(0);
  });

  it('a fighter can stand on every map', () => {
    for (const map of MAPS) {
      const sim = new Simulation({ roster: 'empty', ai: false, mapId: map.id, seed: 8 });
      sim.addFighter('a', 'Ada', 0);
      step(sim, ['a'], 1.5);
      const row = sim.summaries()[0]!;
      expect(sim.respawns, map.id).toBe(0);
      expect(row.y, `${map.id} y=${row.y.toFixed(3)} state=${row.state}`).toBeGreaterThan(0.35);
      expect(sim.getStability().nanEvents, map.id).toBe(0);
      expect(sim.getStability().maxJointSeparation, map.id).toBeLessThan(0.35);
    }
  });
});
