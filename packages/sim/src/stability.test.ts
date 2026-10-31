import { FIXED_DT, emptyInput, type InputFrame } from '@sfc/shared';
import { describe, expect, it } from 'vitest';
import { Simulation, type FighterProbe } from './simulation.js';

function run(sim: Simulation, seconds: number, input: (tick: number) => InputFrame): void {
  const steps = Math.round(seconds / FIXED_DT);
  for (let i = 0; i < steps; i++) sim.step(FIXED_DT, input(i));
}

function hold(patch: Partial<InputFrame>): (tick: number) => InputFrame {
  return (tick) => ({ ...emptyInput(tick, patch.aimX ?? 1, patch.aimY ?? 0), ...patch, seq: tick });
}

function dump(sim: Simulation): string {
  return JSON.stringify(
    {
      player: sim.getProbe('player'),
      dummy: sim.getSnapshot().fighters.some((f) => f.id === 'dummy') ? sim.getProbe('dummy') : null,
      stability: sim.getStability(),
    },
    null,
    2,
  );
}

describe('ragdoll stability', () => {
  it('spawns with coincident joints and a full skeleton', () => {
    const sim = new Simulation({ ai: false, spawnProtect: 0 });
    expect(sim.getProbe('player').jointSeparation).toBeLessThan(0.002);
    expect(sim.getProbe('dummy').jointSeparation).toBeLessThan(0.002);
    const stability = sim.getStability();
    expect(stability.bodyCount).toBe(sim.getSnapshot().solids.length + 28);
    expect(stability.jointCount).toBe(26);
    expect(stability.nanEvents).toBe(0);
  });

  it('stands upright without drifting or stretching', () => {
    const sim = new Simulation({ ai: false, spawnProtect: 0, seed: 2 });
    run(sim, 4, hold({}));
    const player = sim.getProbe('player');
    const dummy = sim.getProbe('dummy');
    expect(player.state, dump(sim)).toMatch(/idle|walk|stumble/);
    for (const probe of [player, dummy]) {
      expect(Math.abs(probe.angle), dump(sim)).toBeLessThan(0.45);
      expect(probe.hipY, dump(sim)).toBeGreaterThan(0.62);
      expect(probe.hipY, dump(sim)).toBeLessThan(1.2);
      expect(Math.abs(probe.vx), dump(sim)).toBeLessThan(0.45);
      expect(probe.jointSeparation, dump(sim)).toBeLessThan(0.03);
    }
    const stability = sim.getStability();
    expect(stability.nanEvents).toBe(0);
    expect(stability.rescueEvents).toBe(0);
    expect(stability.maxJointSeparation).toBeLessThan(0.03);
  });

  it('walks both directions and sprints faster than it walks', () => {
    // No dummy: it stands in the way and caps how far a fast walker can get.
    const right = new Simulation({ ai: false, spawnProtect: 0 });
    right.setDummyEnabled(false);
    const x0 = right.getProbe('player').x;
    run(right, 1.6, hold({ moveX: 1 }));
    const walked = right.getProbe('player').x - x0;
    expect(walked, dump(right)).toBeGreaterThan(2.2);
    expect(Math.abs(right.getProbe('player').angle), dump(right)).toBeLessThan(0.6);
    expect(right.getProbe('player').hipY, dump(right)).toBeGreaterThan(0.65);

    const left = new Simulation({ ai: false, spawnProtect: 0 });
    left.setDummyEnabled(false);
    const lx0 = left.getProbe('player').x;
    run(left, 1.6, hold({ moveX: -1, aimX: -1 }));
    expect(lx0 - left.getProbe('player').x, dump(left)).toBeGreaterThan(2.2);

    const sprint = new Simulation({ ai: false, spawnProtect: 0 });
    sprint.setDummyEnabled(false);
    const sx0 = sprint.getProbe('player').x;
    run(sprint, 1.6, hold({ moveX: 1, sprint: true }));
    expect(sprint.getProbe('player').x - sx0, dump(sprint)).toBeGreaterThan(walked + 1);
  });

  it('jumps and returns to the ground', () => {
    const sim = new Simulation({ ai: false, spawnProtect: 0 });
    run(sim, 0.4, hold({}));
    const y0 = sim.getProbe('player').y;
    let peak = y0;
    let sawAir = false;
    const steps = Math.round(0.7 / FIXED_DT);
    for (let i = 0; i < steps; i++) {
      sim.step(FIXED_DT, { ...emptyInput(i, 1, 0.2), seq: i, jump: i < 12 });
      const probe = sim.getProbe('player');
      peak = Math.max(peak, probe.y);
      if (!probe.grounded || probe.state === 'air') sawAir = true;
    }
    expect(peak - y0, dump(sim)).toBeGreaterThan(0.7);
    expect(sawAir, dump(sim)).toBe(true);
    run(sim, 1.2, hold({}));
    expect(sim.getProbe('player').grounded, dump(sim)).toBe(true);
    expect(Math.abs(sim.getProbe('player').angle), dump(sim)).toBeLessThan(0.6);
  });

  it('crouches lower than its standing hip', () => {
    const sim = new Simulation({ ai: false, spawnProtect: 0 });
    run(sim, 1, hold({}));
    const stand = sim.getProbe('player').hipY;
    run(sim, 1, hold({ crouch: true }));
    const low = sim.getProbe('player').hipY;
    expect(stand - low, dump(sim)).toBeGreaterThan(0.12);
    expect(sim.getProbe('player').state, dump(sim)).toBe('crouch');
  });

  it('punches and kicks the dummy with real knockback', () => {
    const punch = new Simulation({
      ai: false,
      spawnProtect: 0,
      spawns: { player: -0.34, dummy: 0.34 },
    });
    run(punch, 0.35, hold({ aimX: 1, aimY: -0.05 }));
    let minHp = 100;
    let peakVx = 0;
    let knocked = false;
    const steps = Math.round(1.8 / FIXED_DT);
    for (let i = 0; i < steps; i++) {
      punch.step(FIXED_DT, { ...emptyInput(i, 1, -0.05), seq: i, punch: true });
      const dummy = punch.getProbe('dummy');
      minHp = Math.min(minHp, dummy.hp);
      peakVx = Math.max(peakVx, Math.abs(dummy.vx), Math.abs(dummy.vy));
      if (dummy.state === 'fallen' || dummy.state === 'getup' || Math.abs(dummy.angle) > 1) knocked = true;
    }
    expect(knocked, dump(punch)).toBe(true);
    expect(minHp, dump(punch)).toBeLessThan(92);
    expect(peakVx, dump(punch)).toBeGreaterThan(1.5);
    expect(punch.getStability().hitsLanded, dump(punch)).toBeGreaterThan(0);
    expect(punch.getStability().nanEvents).toBe(0);
    expect(punch.getStability().rescueEvents).toBe(0);

    const kick = new Simulation({
      ai: false,
      spawnProtect: 0,
      spawns: { player: -0.46, dummy: 0.46 },
    });
    run(kick, 0.3, hold({ aimX: 1, aimY: -0.1 }));
    let kickHp = 100;
    let kickVx = 0;
    const kickSteps = Math.round(1.6 / FIXED_DT);
    for (let i = 0; i < kickSteps; i++) {
      kick.step(FIXED_DT, { ...emptyInput(i, 1, -0.15), seq: i, kick: true, moveX: 1 });
      const dummy = kick.getProbe('dummy');
      kickHp = Math.min(kickHp, dummy.hp);
      kickVx = Math.max(kickVx, Math.abs(dummy.vx));
    }
    // Kicks now launch the dummy out of reach, so one clean kick is the bar, not two.
    expect(kickHp, dump(kick)).toBeLessThan(92);
    expect(kickVx, dump(kick)).toBeGreaterThan(2);
    expect(kick.getStability().rescueEvents).toBe(0);
  });

  it('grabs and throws, then releases the joint', () => {
    const sim = new Simulation({
      ai: false,
      spawnProtect: 0,
      spawns: { player: -0.36, dummy: 0.36 },
    });
    run(sim, 0.25, hold({ aimX: 1, aimY: 0 }));
    const before = sim.getStability().jointCount;
    sim.step(FIXED_DT, { ...emptyInput(1, 1, 0.1), grab: true });
    run(sim, 0.7, hold({ aimX: 1, aimY: 0.1 }));
    expect(sim.getProbe('player').grabbing, dump(sim)).toBe(true);
    expect(sim.getStability().jointCount, dump(sim)).toBe(before + 1);
    const x0 = sim.getProbe('dummy').x;
    sim.step(FIXED_DT, { ...emptyInput(2, 1, 0.45), throw: true });
    let peak = 0;
    for (let i = 0; i < Math.round(0.4 / FIXED_DT); i++) {
      sim.step(FIXED_DT, { ...emptyInput(i, 1, 0.2), seq: i });
      const dummy = sim.getProbe('dummy');
      peak = Math.max(peak, Math.hypot(dummy.vx, dummy.vy));
    }
    const after = sim.getProbe('dummy');
    expect(sim.getProbe('player').grabbing, dump(sim)).toBe(false);
    expect(sim.getStability().jointCount, dump(sim)).toBe(before);
    expect(peak > 1.5 || Math.abs(after.x - x0) > 0.45 || after.state === 'fallen', dump(sim)).toBe(true);
    expect(sim.getStability().nanEvents).toBe(0);
    expect(sim.getStability().maxJointSeparation).toBeLessThan(0.06);
  });

  it('gets knocked down and stands back up', () => {
    const sim = new Simulation({ ai: false, spawnProtect: 0 });
    run(sim, 0.6, hold({}));
    sim.debugImpulse('player', 4, 2, 9);
    let fell = false;
    const samples: FighterProbe[] = [];
    const steps = Math.round(5 / FIXED_DT);
    for (let i = 0; i < steps; i++) {
      sim.step(FIXED_DT, emptyInput(i));
      const probe = sim.getProbe('player');
      if (i % 15 === 0) samples.push(probe);
      if (probe.state === 'fallen' || probe.state === 'getup' || Math.abs(probe.angle) > 0.9) fell = true;
    }
    const end = sim.getProbe('player');
    expect(fell, `${dump(sim)}\n${JSON.stringify(samples)}`).toBe(true);
    expect(end.state, dump(sim)).toMatch(/idle|walk|crouch|stumble|air/);
    expect(Math.abs(end.angle), dump(sim)).toBeLessThan(0.5);
    expect(end.hipY, dump(sim)).toBeGreaterThan(0.62);
    expect(sim.getStability().nanEvents).toBe(0);
    expect(sim.getStability().rescueEvents).toBe(0);
  });

  it('respawns after falling out of the arena', () => {
    const sim = new Simulation({ ai: false, spawnProtect: 0 });
    const home = sim.getProbe('player').x;
    sim.debugShift('player', 0, -8);
    run(sim, 0.2, hold({}));
    const probe = sim.getProbe('player');
    expect(probe.y, dump(sim)).toBeGreaterThan(0.4);
    expect(Math.abs(probe.x - home), dump(sim)).toBeLessThan(3);
    expect(sim.getStability().respawns).toBeGreaterThan(0);
    expect(sim.getStability().nanEvents).toBe(0);
  });

  it('matches a second sim given the same seed and inputs', () => {
    const a = new Simulation({ seed: 7, ai: true, spawnProtect: 0 });
    const b = new Simulation({ seed: 7, ai: true, spawnProtect: 0 });
    for (let i = 0; i < 240; i++) {
      const input = stressInput(i);
      a.step(FIXED_DT, input);
      b.step(FIXED_DT, input);
    }
    const pa = a.getProbe('player');
    const pb = b.getProbe('player');
    expect(pa.x).toBeCloseTo(pb.x, 5);
    expect(pa.y).toBeCloseTo(pb.y, 5);
    expect(pa.hp).toBeCloseTo(pb.hp, 5);
    expect(a.getProbe('dummy').x).toBeCloseTo(b.getProbe('dummy').x, 5);
  });

  it('survives a minute of fighting without NaNs or exploding joints', () => {
    const sim = new Simulation({ seed: 4, ai: true, spawnProtect: 0.4 });
    const steps = 60 * 60;
    let peakSep = 0;
    for (let i = 0; i < steps; i++) {
      sim.step(FIXED_DT, stressInput(i));
      if (i % 30 === 0) {
        peakSep = Math.max(peakSep, sim.getProbe('player').jointSeparation, sim.getProbe('dummy').jointSeparation);
      }
    }
    const stability = sim.getStability();
    expect(stability.nanEvents, dump(sim)).toBe(0);
    expect(stability.rescueEvents, dump(sim)).toBe(0);
    expect(stability.maxJointSeparation, dump(sim)).toBeLessThan(0.22);
    expect(peakSep, dump(sim)).toBeLessThan(0.22);
    expect(sim.getProbe('player').jointSeparation, dump(sim)).toBeLessThan(0.03);
    expect(sim.getProbe('dummy').jointSeparation, dump(sim)).toBeLessThan(0.03);
    expect(stability.peakSpeed, dump(sim)).toBeLessThan(MAX_RECORDED_SPEED);
    expect(stability.bodyCount).toBe(sim.getSnapshot().solids.length + 28);
    expect(stability.jointCount).toBeGreaterThanOrEqual(26);
    expect(stability.jointCount).toBeLessThanOrEqual(27);
    expect(stability.respawns, dump(sim)).toBeLessThan(25);
    expect(Number.isFinite(sim.getProbe('player').x)).toBe(true);
    expect(Number.isFinite(sim.getProbe('dummy').x)).toBe(true);
  });
});

const MAX_RECORDED_SPEED = 40;

function stressInput(tick: number): InputFrame {
  const t = tick / 60;
  const mode = Math.floor(t) % 8;
  const aimX = Math.cos(t * 1.7);
  const aimY = Math.sin(t * 1.1) * 0.65;
  const base = emptyInput(tick, aimX, aimY);
  if (mode === 0) return { ...base, moveX: 1, sprint: true };
  if (mode === 1) return { ...base, moveX: -1 };
  if (mode === 2) return { ...base, moveX: 1, jump: tick % 42 === 0 };
  if (mode === 3) return { ...base, crouch: true, moveX: -1 };
  if (mode === 4) return { ...base, moveX: 1, punch: true, aimX: 1, aimY: 0.15 };
  if (mode === 5) return { ...base, moveX: 1, kick: true, aimX: 1, aimY: -0.1 };
  if (mode === 6) return { ...base, moveX: 1, grab: tick % 55 === 0, throw: tick % 55 === 28, aimX: 1, aimY: 0.35 };
  return { ...base, moveX: -1, block: true, jump: tick % 64 === 0 };
}
