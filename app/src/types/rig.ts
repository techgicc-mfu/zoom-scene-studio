export type SceneId = 'A' | 'B' | 'C' | 'D';

export const SCENE_IDS: readonly SceneId[] = ['A', 'B', 'C', 'D'] as const;

export type EffectCategory =
  | 'comp'
  | 'drive'
  | 'amp'
  | 'mod'
  | 'delay'
  | 'reverb'
  | 'pedal';

export interface EffectParamSpec {
  name: string;
  min: number;
  max: number;
  defaultValue: number;
  unit?: string;
  warnOnSceneDiff?: boolean;
}

export interface EffectDefinition {
  fxid: number;
  name: string;
  shortName: string;
  category: EffectCategory;
  description: string;
  params: EffectParamSpec[];
}

export interface PedalSlotState {
  enabled: boolean;
  fxid: number;
  params: number[]; // length 9 (P1..P9)
}

export type PedalChain5 = [
  PedalSlotState,
  PedalSlotState,
  PedalSlotState,
  PedalSlotState,
  PedalSlotState,
];

export type Vp1CurveType = 'linear' | 'vp1' | 'swell';

export interface ExpressionConfig {
  /** 0 = Off, 2..6 = MS-50G Slots 2..6 (UI Pedals 1..5) */
  targetSlot: number;
  /** 1..9 parameter knob index on targetSlot */
  targetParam: number;
  minPct: number;
  maxPct: number;
  curve: Vp1CurveType;
}

export interface GigRig {
  index: number; // 0..11 (Patches 01..12)
  name: string;
  tempo: number;
  sceneNames: Record<SceneId, string>;
  /** 0..24 mapped to -6.0 dB .. +6.0 dB in 0.5 dB steps (12 = 0.0 dB) */
  sceneTrims: Record<SceneId, number>;
  scenes: Record<SceneId, PedalChain5>;
  expression: ExpressionConfig;
}

export interface SyncProgress {
  phase: 'backup' | 'ms50g' | 'chocolate' | 'done' | 'error';
  current: number;
  total: number;
  message: string;
}
