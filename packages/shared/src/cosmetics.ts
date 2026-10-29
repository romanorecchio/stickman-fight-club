export interface Cosmetic {
  id: string;
  name: string;
  level: number;
}

export const HATS: Cosmetic[] = [
  { id: 'none', name: 'Bare head', level: 1 },
  { id: 'cap', name: 'Cap', level: 2 },
  { id: 'beanie', name: 'Beanie', level: 4 },
  { id: 'glasses', name: 'Glasses', level: 5 },
  { id: 'crown', name: 'Crown', level: 6 },
  { id: 'halo', name: 'Halo', level: 8 },
];

export const FACES: Cosmetic[] = [
  { id: 'dot', name: 'Dot eyes', level: 1 },
  { id: 'smile', name: 'Smile', level: 2 },
  { id: 'mad', name: 'Mad', level: 3 },
  { id: 'shades', name: 'Shades', level: 5 },
];

export interface Loadout {
  color: number;
  hat: string;
  face: string;
}

export const DEFAULT_LOADOUT: Loadout = { color: 0, hat: 'none', face: 'dot' };

export function levelForXp(xp: number): number {
  return 1 + Math.floor(Math.max(0, xp) / 100);
}

export function colorLimit(level: number): number {
  return level >= 3 ? 7 : 3;
}

export function sanitizeLoadout(raw: unknown, level: number, current: Loadout = DEFAULT_LOADOUT): Loadout | null {
  const body = raw && typeof raw === 'object' ? (raw as Partial<Loadout>) : {};
  const hat = typeof body.hat === 'string' ? body.hat : current.hat;
  const face = typeof body.face === 'string' ? body.face : current.face;
  const color = Number.isFinite(Number(body.color)) ? Math.round(Number(body.color)) : current.color;
  const hatOk = HATS.find((item) => item.id === hat);
  const faceOk = FACES.find((item) => item.id === face);
  if (!hatOk || hatOk.level > level) return null;
  if (!faceOk || faceOk.level > level) return null;
  if (color < 0 || color > colorLimit(level)) return null;
  return { color, hat, face };
}
