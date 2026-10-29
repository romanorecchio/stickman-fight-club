export const FIXED_DT = 1 / 60;
export const MAX_HP = 100;

export const CATEGORY_WORLD = 0x0001;
export const CATEGORY_FIGHTER = 0x0002;

export const PARTS = [
  'head',
  'torso',
  'upperArmF',
  'lowerArmF',
  'handF',
  'upperArmB',
  'lowerArmB',
  'handB',
  'upperLegF',
  'lowerLegF',
  'footF',
  'upperLegB',
  'lowerLegB',
  'footB',
] as const;

export type PartName = (typeof PARTS)[number];

export const JOINTS = [
  'neck',
  'shoulderF',
  'elbowF',
  'wristF',
  'shoulderB',
  'elbowB',
  'wristB',
  'hipF',
  'kneeF',
  'ankleF',
  'hipB',
  'kneeB',
  'ankleB',
] as const;

export type JointName = (typeof JOINTS)[number];

export const POINT_NAMES = [
  'head',
  'neck',
  'shoulder',
  'hip',
  'elbowF',
  'wristF',
  'handF',
  'elbowB',
  'wristB',
  'handB',
  'kneeF',
  'ankleF',
  'heelF',
  'toeF',
  'kneeB',
  'ankleB',
  'heelB',
  'toeB',
] as const;

export type PointName = (typeof POINT_NAMES)[number];

/** Stable id. Training uses `player` and `dummy`; online rooms use server-issued ids. */
export type FighterId = string;

export type FighterState =
  | 'idle'
  | 'walk'
  | 'sprint'
  | 'crouch'
  | 'air'
  | 'stumble'
  | 'fallen'
  | 'getup'
  | 'ko';
