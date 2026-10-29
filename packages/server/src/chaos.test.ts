import { describe, expect, it } from 'vitest';
import { Simulation } from '@sfc/sim';
import { CHAOS_EFFECTS, ChaosControl } from './chaos.js';

describe('chaos control', () => {
  it('lets any player in the room cast, rate-limits per player, and audits', () => {
    const chaos = new ChaosControl();
    expect(chaos.catalog().effects).toHaveLength(30);
    expect(chaos.cast('p1', { effect: 'yeet', targets: 'all' }, ['p1', 'p2'], 1_000)).toEqual({ ok: true, effect: 'yeet' });
    expect(chaos.cast('p1', { effect: 'nope', targets: 'all' }, ['p1'], 1_001)).toEqual({ error: 'Unknown effect.' });
    expect(chaos.cast('p1', { effect: 'yeet', targets: ['stranger'] }, ['p1'], 1_002)).toEqual({ error: 'Pick someone in this lobby.' });
    expect(chaos.cast('p1', null, ['p1'], 1_003)).toEqual({ error: 'Unknown effect.' });
    expect(chaos.cast('p1', 'garbage', ['p1'], 1_004)).toEqual({ error: 'Unknown effect.' });
    for (let i = 0; i < 3; i += 1) chaos.cast('p1', { effect: 'tiny', targets: 'all' }, ['p1'], 1_010 + i);
    expect(chaos.cast('p1', { effect: 'tiny', targets: 'all' }, ['p1'], 1_020)).toEqual({ error: 'Slow down.' });
    expect(chaos.cast('p2', { effect: 'tiny', targets: 'all' }, ['p1', 'p2'], 1_020)).toEqual({ ok: true, effect: 'tiny' });
    expect(chaos.cast('p1', { effect: 'tiny', targets: 'all' }, ['p1'], 12_000)).toEqual({ ok: true, effect: 'tiny' });
    expect(chaos.reset('p2')).toEqual({ ok: true, effect: 'reset' });
    expect(chaos.recentAudit().some((row) => row.action === 'yeet')).toBe(true);
    expect(CHAOS_EFFECTS.map((effect) => effect.id)).toContain('roulette');
  });

  it('yeets without NaNs, skips an opted-out jumpscare, and lets reverse gravity replace zero gravity', () => {
    const chaos = new ChaosControl();
    const sim = new Simulation({ roster: 'empty', ai: false, seed: 3, spawnProtect: 0 });
    sim.addFighter('p1', 'Ada', 0);
    expect(chaos.cast('p2', { effect: 'zero-gravity', targets: 'all', duration: 4 }, ['p1'], 5_000)).toMatchObject({ ok: true });
    expect(chaos.cast('p2', { effect: 'reverse-gravity', targets: 'all', duration: 4 }, ['p1'], 5_100)).toMatchObject({ ok: true });
    expect(chaos.cast('p2', { effect: 'yeet', targets: ['p1'], duration: 2, intensity: 40 }, ['p1'], 5_200)).toMatchObject({ ok: true });
    expect(chaos.cast('p2', { effect: 'nightmare', targets: ['p1'], duration: 4 }, ['p1'], 5_300)).toMatchObject({ ok: true });
    const opted = chaos.apply(sim, [{ id: 'p1', hp: 100, x: 0, y: 1, jumpscares: false, reduceMotion: true, reduceFlash: true }], 5_400);
    expect(opted.get('p1')?.jumpscare).toBeNull();
    for (let i = 0; i < 30; i += 1) sim.stepAll(1 / 60, new Map([['p1', { seq: i + 1, moveX: 0, jump: false, crouch: false, sprint: false, punch: false, kick: false, block: false, grab: false, throw: false, aimX: 1, aimY: 0 }]]));
    expect(sim.getStability().nanEvents).toBe(0);
    expect(sim.getStability().maxJointSeparation).toBeLessThan(0.45);
    const png = `data:image/png;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]).toString('base64')}`;
    expect(chaos.cast('p2', { effect: 'custom', targets: ['p1'], image: 'data:text/html;base64,AAAA' }, ['p1'], 6_000)).toEqual({
      error: 'Custom jumpscares must be a PNG or JPEG under 400 KB.',
    });
    expect(chaos.cast('p2', { effect: 'custom', targets: ['p1'], image: png }, ['p1'], 6_100)).toMatchObject({ ok: true });
  });
});
