import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Accounts } from './accounts.js';

describe('accounts', () => {
  it('registers, rejects a bad password, saves a match, and reloads from disk', () => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), 'sfc-db-')), 'accounts.sqlite');
    const accounts = new Accounts(file);
    const created = accounts.register('Ada', 'correct-horse');
    expect('token' in created).toBe(true);
    if (!('token' in created)) return;
    expect(accounts.login('Ada', 'wrong-password')).toEqual({ error: 'That name or password does not match.' });
    const lockedHat = accounts.equip(created.token, { color: 0, hat: 'crown', face: 'dot' });
    expect('error' in lockedHat).toBe(true);
    expect(accounts.equip(created.token, { color: 0, hat: 'none', face: 'smile' })).toEqual({ error: 'That color or hat is still locked.' });
    const look = accounts.equip(created.token, { color: 2, hat: 'none', face: 'dot' });
    expect('profile' in look && look.profile.loadout.color).toBe(2);
    const id = accounts.userId(created.token);
    expect(id).not.toBeNull();
    accounts.record([{
      userId: id!,
      won: true,
      kills: 3,
      deaths: 1,
      damageDealt: 80,
      damageTaken: 20,
      playSeconds: 40,
      kothPoints: 0,
      infectionWin: false,
      duelWin: true,
      idle: false,
    }]);
    const again = new Accounts(file);
    const profile = again.profile(created.token);
    expect(profile?.wins).toBe(1);
    expect(profile?.kills).toBe(3);
    expect(profile?.duelWins).toBe(1);
    expect(profile?.xp).toBeGreaterThan(40);
    expect(again.leaderboard()[0]?.username).toBe('Ada');
    accounts.record([{
      userId: id!,
      won: false,
      kills: 0,
      deaths: 0,
      damageDealt: 0,
      damageTaken: 0,
      playSeconds: 5,
      kothPoints: 0,
      infectionWin: false,
      duelWin: false,
      idle: true,
    }]);
    expect(accounts.profile(created.token)?.matches).toBe(1);
  });
});
