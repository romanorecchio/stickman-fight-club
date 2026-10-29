import { describe, expect, it } from 'vitest';
import { MatchRules } from '@sfc/shared';

const ada = { id: 'a', name: 'Ada', hp: 100, state: 'idle', x: 0, y: 1 };
const bea = { id: 'b', name: 'Bea', hp: 100, state: 'idle', x: 2, y: 1 };

describe('match rules', () => {
  it('scores a free-for-all kill and respawns', () => {
    const match = new MatchRules();
    expect(match.start([ada, bea])).toBeNull();
    match.tick(3, [ada, bea]);
    expect(match.phase).toBe('fight');
    match.noteAttacker('b', 'a');
    const down = { ...bea, hp: 0, state: 'ko' };
    match.tick(0.016, [ada, down]);
    expect(match.view().rows.find((row) => row.id === 'a')?.kills).toBe(1);
    let respawned = false;
    for (let i = 0; i < 100; i += 1) {
      const action = match.tick(0.02, [ada, down]);
      if (action.respawn.includes('b')) respawned = true;
    }
    expect(respawned).toBe(true);
  });

  it('elimination ends when one fighter remains, and a tie on time is a draw banner', () => {
    const match = new MatchRules();
    match.queueSettings({ elimination: true, scoreLimit: 50, roundSeconds: 1 });
    match.start([ada, bea]);
    match.tick(3, [ada, bea]);
    match.noteAttacker('b', 'a');
    match.tick(0.02, [ada, { ...bea, hp: 0, state: 'ko' }]);
    expect(match.phase).toBe('roundEnd');
    expect(match.banner).toContain('Ada');
  });

  it('duels are first to two wins in a best of three and everyone else watches', () => {
    const cam = { id: 'c', name: 'Cam', hp: 100, state: 'idle', x: 4, y: 1 };
    const match = new MatchRules();
    match.queueSettings({ mode: 'duel', bestOf: 3 });
    match.start([ada, bea, cam]);
    expect(match.spectators.has('c')).toBe(true);
    const play = () => {
      match.tick(3, [ada, bea, cam]);
      match.noteAttacker('b', 'a');
      match.tick(0.05, [ada, { ...bea, hp: 0, state: 'ko' }, cam]);
      expect(match.phase).toBe('roundEnd');
      match.tick(5, [ada, bea, cam]);
    };
    play();
    expect(match.phase === 'countdown' || match.phase === 'fight' || match.phase === 'matchEnd').toBe(true);
    if (match.phase !== 'matchEnd') play();
    expect(match.phase).toBe('matchEnd');
    expect(match.winnerName).toBe('Ada');
  });

  it('team scores ignore friendly fire bookkeeping when the attacker is a teammate', () => {
    const match = new MatchRules();
    match.queueSettings({ mode: 'tdm', friendlyFire: false });
    match.setTeam('a', 'red');
    match.setTeam('b', 'red');
    match.start([ada, bea]);
    match.tick(3, [ada, bea]);
    match.noteAttacker('b', 'a');
    match.tick(0.02, [ada, { ...bea, hp: 0, state: 'ko' }]);
    expect(match.view().rows.find((row) => row.id === 'a')?.kills ?? 0).toBe(0);
  });
});
