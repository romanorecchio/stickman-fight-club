export type WeaponClass = 'melee' | 'firearm' | 'explosive' | 'novelty';
export type WeaponKind = 'swing' | 'hitscan' | 'projectile' | 'place' | 'pull';

export interface WeaponDef {
  id: string;
  name: string;
  cls: WeaponClass;
  kind: WeaponKind;
  rarity: number;
  damage: number;
  knockback: number;
  reach: number;
  cooldown: number;
  rate: number;
  range: number;
  spread: number;
  pellets: number;
  mag: number;
  reserve: number;
  reload: number;
  radius: number;
  fuse: number;
  speed: number;
  breaks: boolean;
  slip: boolean;
  sticky: boolean;
  mine: boolean;
}

export interface WeaponCategories {
  melee: boolean;
  firearm: boolean;
  explosive: boolean;
  novelty: boolean;
}

export const ALL_CATEGORIES: WeaponCategories = {
  melee: true,
  firearm: true,
  explosive: true,
  novelty: true,
};

const swing = (partial: Partial<WeaponDef> & Pick<WeaponDef, 'id' | 'name' | 'cls'>): WeaponDef => ({
  kind: 'swing',
  rarity: 8,
  damage: 14,
  knockback: 1,
  reach: 1.3,
  cooldown: 0.42,
  rate: 0,
  range: 0,
  spread: 0,
  pellets: 1,
  mag: 0,
  reserve: 0,
  reload: 0,
  radius: 0,
  fuse: 0,
  speed: 0,
  breaks: false,
  slip: false,
  sticky: false,
  mine: false,
  ...partial,
});

const gun = (partial: Partial<WeaponDef> & Pick<WeaponDef, 'id' | 'name'>): WeaponDef => ({
  cls: 'firearm',
  kind: 'hitscan',
  rarity: 5,
  damage: 12,
  knockback: 0.35,
  reach: 0.7,
  cooldown: 0,
  rate: 3,
  range: 14,
  spread: 0.05,
  pellets: 1,
  mag: 12,
  reserve: 36,
  reload: 1.1,
  radius: 0,
  fuse: 0,
  speed: 0,
  breaks: false,
  slip: false,
  sticky: false,
  mine: false,
  ...partial,
});

const bomb = (partial: Partial<WeaponDef> & Pick<WeaponDef, 'id' | 'name'>): WeaponDef => ({
  cls: 'explosive',
  kind: 'projectile',
  rarity: 3,
  damage: 36,
  knockback: 1.6,
  reach: 0.6,
  cooldown: 0.8,
  rate: 0,
  range: 0,
  spread: 0.08,
  pellets: 1,
  mag: 1,
  reserve: 3,
  reload: 0.6,
  radius: 2.3,
  fuse: 1.15,
  speed: 9,
  breaks: true,
  slip: false,
  sticky: false,
  mine: false,
  ...partial,
});

export const WEAPONS: WeaponDef[] = [
  swing({ id: 'bat', name: 'Baseball bat', cls: 'melee', damage: 15, knockback: 1.25, reach: 1.35, cooldown: 0.42, rarity: 10 }),
  swing({ id: 'sword', name: 'Sword', cls: 'melee', damage: 18, knockback: 0.72, reach: 1.5, cooldown: 0.36, rarity: 7 }),
  swing({ id: 'hammer', name: 'Hammer', cls: 'melee', damage: 22, knockback: 1.7, reach: 1.2, cooldown: 0.68, breaks: true, rarity: 6 }),
  swing({ id: 'knife', name: 'Knife', cls: 'melee', damage: 12, knockback: 0.4, reach: 0.85, cooldown: 0.22, rarity: 9 }),
  swing({ id: 'crowbar', name: 'Crowbar', cls: 'melee', damage: 16, knockback: 1.15, reach: 1.25, cooldown: 0.48, rarity: 8 }),
  swing({ id: 'spear', name: 'Spear', cls: 'melee', damage: 17, knockback: 0.9, reach: 1.95, cooldown: 0.52, rarity: 6 }),
  swing({ id: 'mallet', name: 'Giant mallet', cls: 'melee', damage: 26, knockback: 2.1, reach: 1.45, cooldown: 0.82, breaks: true, rarity: 3 }),
  swing({ id: 'shield', name: 'Shield', cls: 'melee', damage: 8, knockback: 0.85, reach: 0.8, cooldown: 0.4, rarity: 6 }),
  gun({ id: 'pistol', name: 'Pistol', damage: 18, knockback: 0.32, rate: 3.2, range: 15, spread: 0.035, mag: 12, reserve: 36, reload: 1.05, rarity: 8 }),
  gun({ id: 'revolver', name: 'Revolver', damage: 28, knockback: 0.55, rate: 1.5, range: 16, spread: 0.02, mag: 6, reserve: 24, reload: 1.35, rarity: 5 }),
  gun({ id: 'shotgun', name: 'Shotgun', damage: 9, knockback: 0.7, rate: 0.9, range: 7.5, spread: 0.22, pellets: 6, mag: 6, reserve: 18, reload: 1.6, rarity: 5 }),
  gun({ id: 'ar', name: 'Assault rifle', damage: 11, knockback: 0.28, rate: 8, range: 16, spread: 0.07, mag: 30, reserve: 90, reload: 1.45, rarity: 4 }),
  gun({ id: 'sniper', name: 'Sniper', damage: 46, knockback: 0.9, rate: 0.55, range: 22, spread: 0.008, mag: 5, reserve: 15, reload: 1.8, rarity: 2 }),
  gun({ id: 'smg', name: 'SMG', damage: 8, knockback: 0.22, rate: 12, range: 12, spread: 0.1, mag: 32, reserve: 96, reload: 1.25, rarity: 5 }),
  bomb({ id: 'grenade', name: 'Grenade', damage: 40, radius: 2.4, fuse: 1.15, speed: 9, mag: 1, reserve: 4, rarity: 5 }),
  bomb({ id: 'rocket', name: 'Rocket launcher', damage: 48, knockback: 2.1, radius: 2.7, fuse: 2.4, speed: 16, mag: 1, reserve: 3, cooldown: 1.1, rarity: 2 }),
  bomb({ id: 'mine', name: 'Landmine', kind: 'place', damage: 36, radius: 2.0, fuse: 0, speed: 0, mine: true, mag: 1, reserve: 3, cooldown: 0.7, rarity: 4 }),
  bomb({ id: 'sticky', name: 'Sticky bomb', damage: 38, radius: 2.15, fuse: 1.35, speed: 11, sticky: true, mag: 1, reserve: 3, rarity: 3 }),
  bomb({ id: 'dynamite', name: 'Dynamite', damage: 46, radius: 3.0, fuse: 1.9, speed: 7.5, mag: 1, reserve: 2, rarity: 3 }),
  swing({ id: 'pan', name: 'Frying pan', cls: 'novelty', damage: 16, knockback: 1.55, reach: 1.15, cooldown: 0.4, rarity: 7 }),
  swing({ id: 'glove', name: 'Boxing glove', cls: 'novelty', damage: 14, knockback: 2.3, reach: 1.55, cooldown: 0.66, rarity: 5 }),
  swing({
    id: 'gravity',
    name: 'Gravity gun',
    cls: 'novelty',
    kind: 'pull',
    damage: 6,
    knockback: 1.8,
    reach: 4,
    cooldown: 0.15,
    rarity: 2,
  }),
  bomb({ id: 'chicken', name: 'Exploding chicken', cls: 'novelty', damage: 24, radius: 1.7, fuse: 0.9, speed: 11, mag: 1, reserve: 5, rarity: 3 }),
  swing({ id: 'energy', name: 'Energy sword', cls: 'novelty', damage: 20, knockback: 0.55, reach: 1.7, cooldown: 0.28, rarity: 3 }),
  swing({ id: 'fish', name: 'Fish', cls: 'novelty', damage: 11, knockback: 1.05, reach: 1.3, cooldown: 0.34, slip: true, rarity: 6 }),
  bomb({
    id: 'banana',
    name: 'Banana launcher',
    cls: 'novelty',
    damage: 8,
    knockback: 0.4,
    radius: 1.3,
    fuse: 0.7,
    speed: 12,
    slip: true,
    breaks: false,
    mag: 1,
    reserve: 6,
    rarity: 4,
  }),
  swing({ id: 'club', name: 'Wooden club', cls: 'novelty', damage: 24, knockback: 1.9, reach: 1.5, cooldown: 0.74, breaks: true, rarity: 4 }),
];

const BY_ID = new Map(WEAPONS.map((weapon) => [weapon.id, weapon]));

export function weaponById(id: string | null | undefined): WeaponDef | null {
  if (!id) return null;
  return BY_ID.get(id) ?? null;
}

export function sanitizeCategories(raw: unknown, current: WeaponCategories = ALL_CATEGORIES): WeaponCategories {
  const body = raw && typeof raw === 'object' ? (raw as Partial<WeaponCategories>) : {};
  return {
    melee: typeof body.melee === 'boolean' ? body.melee : current.melee,
    firearm: typeof body.firearm === 'boolean' ? body.firearm : current.firearm,
    explosive: typeof body.explosive === 'boolean' ? body.explosive : current.explosive,
    novelty: typeof body.novelty === 'boolean' ? body.novelty : current.novelty,
  };
}

export function rollWeapon(rng: () => number, categories: WeaponCategories, allow: WeaponClass[] | null): WeaponDef {
  const pool = WEAPONS.filter((weapon) => categories[weapon.cls] && (!allow || allow.includes(weapon.cls)));
  const source = pool.length > 0 ? pool : WEAPONS;
  const total = source.reduce((sum, weapon) => sum + weapon.rarity, 0);
  let roll = rng() * total;
  for (const weapon of source) {
    roll -= weapon.rarity;
    if (roll <= 0) return weapon;
  }
  return source[0] ?? WEAPONS[0]!;
}
