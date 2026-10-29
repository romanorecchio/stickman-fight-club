import type { SolidKind } from './types.js';
import type { WeaponClass } from './weapons.js';

export type MapId = 'classic' | 'rooftop' | 'lava' | 'destruction' | 'sky' | 'boxing';
export type MapTheme = 'night' | 'roof' | 'lava' | 'yard' | 'sky' | 'ring';

export interface MapMove {
  axis: 'x' | 'y';
  amp: number;
  period: number;
  phase: number;
}

export interface SolidDef {
  x: number;
  y: number;
  hx: number;
  hy: number;
  kind: SolidKind;
  move?: MapMove;
  hp?: number;
  barrel?: boolean;
}

export interface HazardDef {
  kind: 'lava' | 'pit' | 'conveyor';
  x: number;
  y: number;
  hx: number;
  hy: number;
  dps: number;
  force: number;
}

export interface MapDef {
  id: MapId;
  name: string;
  theme: MapTheme;
  modes: string[];
  bounds: { minX: number; maxX: number; minY: number; maxY: number };
  killBelow: number;
  spawns: number[];
  weaponPoints: { x: number; y: number }[];
  solids: SolidDef[];
  hazards: HazardDef[];
  /** When set, pickups on this map only roll these classes. */
  allow: WeaponClass[] | null;
}

const ALL_MODES = ['ffa', 'tdm', 'duel', 'infection', 'koth'];

export const MAPS: MapDef[] = [
  {
    id: 'classic',
    name: 'Classic Arena',
    theme: 'night',
    modes: ALL_MODES,
    bounds: { minX: -12, maxX: 12, minY: -1, maxY: 9 },
    killBelow: -3,
    spawns: [-8.8, -3.3, -1.6, 0.6, 2.05, 3.5, 8.5, 9.8],
    weaponPoints: [
      { x: -9, y: 0.65 },
      { x: -4.2, y: 2.05 },
      { x: 0, y: 3.35 },
      { x: 4.2, y: 2.15 },
      { x: 6.4, y: 0.65 },
      { x: 9.2, y: 0.65 },
    ],
    solids: [],
    hazards: [],
    allow: null,
  },
  {
    id: 'rooftop',
    name: 'Rooftop Rumble',
    theme: 'roof',
    modes: ALL_MODES,
    bounds: { minX: -12, maxX: 12, minY: -2, maxY: 9 },
    killBelow: -2.4,
    spawns: [-10.2, -8.2, -5.6, -3.6, 4.2, 6.4, 8.4, 10.4],
    weaponPoints: [
      { x: -9, y: 0.7 },
      { x: -5, y: 0.7 },
      { x: 0, y: 2.15 },
      { x: 5.5, y: 0.7 },
      { x: 9, y: 0.7 },
    ],
    solids: [
      { x: -7.2, y: -0.5, hx: 4.7, hy: 0.5, kind: 'ground' },
      { x: 7.1, y: -0.5, hx: 4.8, hy: 0.5, kind: 'ground' },
      { x: -12.35, y: 4, hx: 0.4, hy: 7, kind: 'wall' },
      { x: 12.35, y: 4, hx: 0.4, hy: 7, kind: 'wall' },
      { x: 0, y: 1.72, hx: 1.55, hy: 0.12, kind: 'platform' },
      { x: -4.4, y: 2.5, hx: 0.85, hy: 0.12, kind: 'platform', move: { axis: 'y', amp: 0.7, period: 4.2, phase: 0 } },
      { x: 3.0, y: 2.55, hx: 0.8, hy: 0.12, kind: 'platform', move: { axis: 'y', amp: 0.65, period: 3.6, phase: 1.2 } },
      { x: -2.85, y: 0.55, hx: 0.08, hy: 0.5, kind: 'rubble', hp: 24 },
      { x: 2.55, y: 0.55, hx: 0.08, hy: 0.5, kind: 'rubble', hp: 24 },
      { x: 9.4, y: 0.36, hx: 0.42, hy: 0.36, kind: 'crate', hp: 30 },
    ],
    hazards: [{ kind: 'pit', x: 0, y: -1.3, hx: 2.3, hy: 1.1, dps: 0, force: 0 }],
    allow: null,
  },
  {
    id: 'lava',
    name: 'Lava Factory',
    theme: 'lava',
    modes: ALL_MODES,
    bounds: { minX: -12, maxX: 12, minY: -1, maxY: 9 },
    killBelow: -3,
    spawns: [-10.4, -8.6, -6.6, -5.2, 5.2, 6.8, 8.8, 10.4],
    weaponPoints: [
      { x: -9, y: 0.7 },
      { x: -6, y: 0.7 },
      { x: 0, y: 3.05 },
      { x: 6.2, y: 0.7 },
      { x: 9.2, y: 0.7 },
    ],
    solids: [
      { x: -8.1, y: -0.5, hx: 3.9, hy: 0.5, kind: 'ground' },
      { x: 8.1, y: -0.5, hx: 3.9, hy: 0.5, kind: 'ground' },
      { x: -12.35, y: 4, hx: 0.4, hy: 7, kind: 'wall' },
      { x: 12.35, y: 4, hx: 0.4, hy: 7, kind: 'wall' },
      { x: -2.1, y: 0.95, hx: 0.9, hy: 0.12, kind: 'platform', move: { axis: 'y', amp: 0.75, period: 3.4, phase: 0 } },
      { x: 2.1, y: 1.45, hx: 0.9, hy: 0.12, kind: 'platform', move: { axis: 'y', amp: 0.85, period: 4, phase: 1 } },
      { x: 0, y: 2.7, hx: 1.15, hy: 0.12, kind: 'platform' },
      { x: 0, y: 4.6, hx: 0.42, hy: 0.32, kind: 'crate', move: { axis: 'y', amp: 2.1, period: 3.1, phase: 0.4 } },
    ],
    hazards: [
      { kind: 'lava', x: 0, y: 0.05, hx: 3.9, hy: 0.45, dps: 42, force: 0 },
      { kind: 'conveyor', x: -8.1, y: 0.35, hx: 3.6, hy: 0.45, dps: 0, force: 16 },
    ],
    allow: null,
  },
  {
    id: 'destruction',
    name: 'Destruction Zone',
    theme: 'yard',
    modes: ALL_MODES,
    bounds: { minX: -12, maxX: 12, minY: -1, maxY: 9 },
    killBelow: -3,
    spawns: [-10, -7.6, -5.2, -2.4, 2.4, 4.8, 7.4, 10],
    weaponPoints: [
      { x: -8.5, y: 0.7 },
      { x: -4, y: 0.7 },
      { x: 0, y: 2.9 },
      { x: 4, y: 0.7 },
      { x: 8.6, y: 0.7 },
    ],
    solids: [
      { x: 0, y: -0.5, hx: 12.2, hy: 0.5, kind: 'ground' },
      { x: -12.35, y: 4, hx: 0.4, hy: 7, kind: 'wall' },
      { x: 12.35, y: 4, hx: 0.4, hy: 7, kind: 'wall' },
      { x: -3.1, y: 1.15, hx: 0.16, hy: 1.15, kind: 'rubble', hp: 48 },
      { x: 3.1, y: 1.15, hx: 0.16, hy: 1.15, kind: 'rubble', hp: 48 },
      { x: 0, y: 2.45, hx: 1.35, hy: 0.1, kind: 'platform', hp: 26 },
      { x: -6.2, y: 0.34, hx: 0.4, hy: 0.34, kind: 'crate', hp: 28 },
      { x: 6.2, y: 0.34, hx: 0.4, hy: 0.34, kind: 'crate', hp: 28 },
      { x: -0.15, y: 0.3, hx: 0.28, hy: 0.3, kind: 'barrel', hp: 16, barrel: true },
      { x: 1.15, y: 0.3, hx: 0.28, hy: 0.3, kind: 'barrel', hp: 16, barrel: true },
      { x: 8.8, y: 0.3, hx: 0.28, hy: 0.3, kind: 'barrel', hp: 16, barrel: true },
    ],
    hazards: [],
    allow: null,
  },
  {
    id: 'sky',
    name: 'Sky Platforms',
    theme: 'sky',
    modes: ALL_MODES,
    bounds: { minX: -12, maxX: 12, minY: -2, maxY: 9 },
    killBelow: -1.6,
    spawns: [-9.0, -7.0, -4.4, -2.0, 1.2, 3.5, 6.2, 8.8],
    weaponPoints: [
      { x: -8, y: 0.55 },
      { x: -3.2, y: 0.55 },
      { x: 2.4, y: 0.55 },
      { x: 7.6, y: 0.55 },
      { x: 0, y: 3.1 },
    ],
    solids: [
      { x: -8, y: -0.12, hx: 1.7, hy: 0.12, kind: 'platform' },
      { x: -3.2, y: -0.12, hx: 1.55, hy: 0.12, kind: 'platform' },
      { x: 2.35, y: -0.12, hx: 1.55, hy: 0.12, kind: 'platform' },
      { x: 7.5, y: -0.12, hx: 1.75, hy: 0.12, kind: 'platform' },
      { x: -5.4, y: 2.05, hx: 1.05, hy: 0.1, kind: 'platform' },
      { x: 0.2, y: 2.55, hx: 1.15, hy: 0.1, kind: 'platform', move: { axis: 'x', amp: 1.5, period: 5, phase: 0 } },
      { x: 5.1, y: 1.85, hx: 1, hy: 0.1, kind: 'platform', move: { axis: 'y', amp: 0.55, period: 3.3, phase: 0.8 } },
      { x: -1.2, y: 5.1, hx: 0.28, hy: 0.28, kind: 'crate', move: { axis: 'y', amp: 2.3, period: 2.7, phase: 0 } },
      { x: -12.35, y: 4, hx: 0.4, hy: 7, kind: 'wall' },
      { x: 12.35, y: 4, hx: 0.4, hy: 7, kind: 'wall' },
    ],
    hazards: [{ kind: 'pit', x: 0, y: -1.6, hx: 12, hy: 1.2, dps: 0, force: 0 }],
    allow: null,
  },
  {
    id: 'boxing',
    name: 'Boxing Club',
    theme: 'ring',
    modes: ['ffa', 'duel', 'tdm'],
    bounds: { minX: -7, maxX: 7, minY: -1, maxY: 6 },
    killBelow: -3,
    spawns: [-4.9, -3.5, -2.1, -0.7, 0.7, 2.1, 3.5, 4.9],
    weaponPoints: [
      { x: -3.2, y: 0.6 },
      { x: 0, y: 0.6 },
      { x: 3.2, y: 0.6 },
    ],
    solids: [
      { x: 0, y: -0.5, hx: 6.15, hy: 0.5, kind: 'ground' },
      { x: -6.45, y: 2.2, hx: 0.22, hy: 2.8, kind: 'wall' },
      { x: 6.45, y: 2.2, hx: 0.22, hy: 2.8, kind: 'wall' },
      { x: -3.1, y: 1.15, hx: 2.4, hy: 0.05, kind: 'rope' },
      { x: 3.1, y: 1.15, hx: 2.4, hy: 0.05, kind: 'rope' },
      { x: -3.1, y: 1.7, hx: 2.4, hy: 0.05, kind: 'rope' },
      { x: 3.1, y: 1.7, hx: 2.4, hy: 0.05, kind: 'rope' },
    ],
    hazards: [],
    allow: ['melee', 'novelty'],
  },
];

const BY_ID = new Map(MAPS.map((map) => [map.id, map]));

export function mapById(id: string | null | undefined): MapDef {
  return BY_ID.get(id as MapId) ?? MAPS[0]!;
}

export function sanitizeMapId(id: unknown): MapId {
  return typeof id === 'string' && BY_ID.has(id as MapId) ? (id as MapId) : 'classic';
}
