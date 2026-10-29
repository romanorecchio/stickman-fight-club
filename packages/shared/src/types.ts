import type { FighterId, FighterState, PartName, PointName } from './constants.js';
import type { MatchView } from './match.js';

/** Client → sim (and, in Phase 2, client → server). Positions are never sent. */
export interface InputFrame {
  seq: number;
  /** -1 left, 1 right, 0 idle. */
  moveX: number;
  jump: boolean;
  crouch: boolean;
  sprint: boolean;
  punch: boolean;
  kick: boolean;
  block: boolean;
  grab: boolean;
  throw: boolean;
  /** World-space aim vector. Magnitude is ignored. Y is up. */
  aimX: number;
  aimY: number;
}

export interface Vec2 {
  x: number;
  y: number;
}

export interface PartPose {
  part: PartName;
  x: number;
  y: number;
  angle: number;
  shape: 'box' | 'circle';
  hx: number;
  hy: number;
}

export interface FighterSnapshot {
  id: FighterId;
  name: string;
  hp: number;
  maxHp: number;
  state: FighterState;
  facing: 1 | -1;
  vx: number;
  vy: number;
  grounded: boolean;
  blocking: boolean;
  grabbing: boolean;
  grabbed: boolean;
  attack: 'punch' | 'kick' | null;
  protecting: boolean;
  flash: number;
  headAngle: number;
  /** Palette index. Training: 0 you, 1 dummy. */
  color: number;
  parts: PartPose[];
  points: Record<PointName, Vec2>;
}

export type SolidKind = 'ground' | 'wall' | 'platform' | 'crate';

export interface SolidSnapshot {
  x: number;
  y: number;
  hx: number;
  hy: number;
  kind: SolidKind;
}

export type EffectKind = 'hit' | 'block' | 'throw' | 'text';

export interface EffectSnapshot {
  id: number;
  kind: EffectKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  mag: number;
  text: string;
}

export interface Snapshot {
  tick: number;
  time: number;
  lastInputSeq: number;
  banner: string | null;
  fighters: FighterSnapshot[];
  solids: SolidSnapshot[];
  effects: EffectSnapshot[];
  bounds: { minX: number; maxX: number; minY: number; maxY: number };
  match?: MatchView | null;
}

export function emptyInput(seq = 0, aimX = 1, aimY = 0): InputFrame {
  return {
    seq,
    moveX: 0,
    jump: false,
    crouch: false,
    sprint: false,
    punch: false,
    kick: false,
    block: false,
    grab: false,
    throw: false,
    aimX,
    aimY,
  };
}
