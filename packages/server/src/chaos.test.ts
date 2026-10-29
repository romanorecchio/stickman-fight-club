import { randomBytes, scryptSync } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Simulation } from '@sfc/sim';
import { Accounts } from './accounts.js';
import { CHAOS_EFFECTS, ChaosControl, ownerPasswordMatches } from './chaos.js';

function hash(secret: string): string {
  const salt = randomBytes(8).toString('hex');
  return `scrypt$${salt}$${scryptSync(secret, salt, 32).toString('hex')}`;
}

describe('chaos control', () => {
  it('hides the gate from everyone except the env owner and locks bad codes', () => {
    process.env.OWNER_USERNAME = 'Roman';
    process.env.OWNER_PASSWORD_HASH = hash('owner-pass-99');
    process.env.OWNER_CHAOS_CODE_HASH = hash('club-code-99');
    const accounts = new Accounts(path.join(mkdtempSync(path.join(tmpdir(), 'sfc-chaos-')), 'a.sqlite'));
    const chaos = new ChaosControl(accounts);
    expect(ownerPasswordMatches('Roman', 'nope')).toBe(false);
    expect(ownerPasswordMatches('Roman', 'owner-pass-99')).toBe(true);
    expect(ownerPasswordMatches('Ada', 'owner-pass-99')).toBe(false);
    expect(chaos.begin('not-a-session')).toBeNull();
    chaos.noteOwner('owner-token', 1_000);
    expect(chaos.begin('owner-token', 1_000)?.effects).toHaveLength(30);
    expect(chaos.cast('owner-token', { effect: 'yeet', targets: 'all' }, ['p1'], 1_000)).toBeNull();
    for (let i = 0; i < 5; i += 1) {
      expect(chaos.submitCode('owner-token', 'wrong', 1_000 + i)).toEqual({ error: 'That code was refused.' });
    }
    expect(chaos.submitCode('owner-token', 'club-code-99', 2_000)).toEqual({ error: 'Locked. Wait and try again.' });
    expect(accounts.recentAudit().some((row) => row.action === 'bad-code')).toBe(true);
    expect(CHAOS_EFFECTS.map((effect) => effect.id)).toContain('roulette');
  });

  it('yeets without NaNs, skips an opted-out jumpscare, and lets reverse gravity replace zero gravity', () => {
    process.env.OWNER_CHAOS_CODE_HASH = hash('club-code-99');
    const chaos = new ChaosControl(null);
    chaos.noteOwner('owner-token', 5_000);
    expect(chaos.submitCode('owner-token', 'club-code-99', 5_000)).toEqual({ ok: true });
    const sim = new Simulation({ roster: 'empty', ai: false, seed: 3, spawnProtect: 0 });
    sim.addFighter('p1', 'Ada', 0);
    expect(chaos.cast('owner-token', { effect: 'zero-gravity', targets: 'all', duration: 4 }, ['p1'], 5_000)).toEqual({ ok: true });
    expect(chaos.cast('owner-token', { effect: 'reverse-gravity', targets: 'all', duration: 4 }, ['p1'], 5_100)).toEqual({ ok: true });
    expect(chaos.cast('owner-token', { effect: 'yeet', targets: ['p1'], duration: 2, intensity: 40 }, ['p1'], 5_200)).toEqual({ ok: true });
    expect(chaos.cast('owner-token', { effect: 'nightmare', targets: ['p1'], duration: 4 }, ['p1'], 5_300)).toEqual({ ok: true });
    const opted = chaos.apply(sim, [{ id: 'p1', hp: 100, x: 0, y: 1, jumpscares: false, reduceMotion: true, reduceFlash: true }], 5_400);
    expect(opted.get('p1')?.jumpscare).toBeNull();
    for (let i = 0; i < 30; i += 1) sim.stepAll(1 / 60, new Map([['p1', { seq: i + 1, moveX: 0, jump: false, crouch: false, sprint: false, punch: false, kick: false, block: false, grab: false, throw: false, aimX: 1, aimY: 0 }]]));
    expect(sim.getStability().nanEvents).toBe(0);
    expect(sim.getStability().maxJointSeparation).toBeLessThan(0.45);
    const png = `data:image/png;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]).toString('base64')}`;
    expect(chaos.cast('owner-token', { effect: 'custom', targets: ['p1'], image: 'data:text/html;base64,AAAA' }, ['p1'], 6_000)).toEqual({
      error: 'Custom jumpscares must be a PNG or JPEG under 400 KB.',
    });
    expect(chaos.cast('owner-token', { effect: 'custom', targets: ['p1'], image: png }, ['p1'], 6_100)).toEqual({ ok: true });
  });
});
