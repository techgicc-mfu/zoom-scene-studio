import { EffectCategory, GigRig, PedalSlotState } from '../types/rig';
import { getEffectDefinition, isGuitarAmpFxid } from './effectCatalog';
import { INSTALLED_EFFECTS } from './installedEffects';

/**
 * Estimated DSP load of each effect on Zoom's own 0-100 scale, taken from Zoom's published "Effect Processing Power Chart"
 * (zoom.co.jp, E_FX-power-chart.pdf), matched to the effect files installed on the MS-50G. Effects not in that chart get the
 * typical value of their category. The pedal's own meter is the final word; this is an estimate to find heavy chains.
 */
const CHART_BY_FILE: Record<string, number> = {
  'COMP.ZDL': 6, 'RACKCOMP.ZDL': 7, 'ZNR.ZDL': 4, 'SLWATK.ZDL': 5, 'GRAYCOMP.ZDL': 20, 'NOISEGTE.ZDL': 7,
  'AUTOWAH.ZDL': 7, 'CRY.ZDL': 6, 'PEQ.ZDL': 5, 'GEQ.ZDL': 5,
  'TS_DRIVE.ZDL': 16, 'CENTAGLD.ZDL': 21, 'RCBOOST.ZDL': 15, 'SWEETDRV.ZDL': 28, 'MTLWRLD.ZDL': 13, 'RED_CRU.ZDL': 18,
  'NYC_MUFF.ZDL': 14, 'ACOSIM.ZDL': 13,
  'CHORUS.ZDL': 8, 'TREMOLO.ZDL': 9, 'PHASER.ZDL': 7, 'THEVIBE.ZDL': 10, 'OCTAVE.ZDL': 7, 'VIBRATO.ZDL': 7, 'DETUNE.ZDL': 6,
  'RINGMOD.ZDL': 5, 'MNPIT.ZDL': 7, 'SUPERCHO.ZDL': 8,
  'APANDLY.ZDL': 9, 'ANLGDLY.ZDL': 5, 'DELAY.ZDL': 5, 'RVRSDLY.ZDL': 6, 'TAPEECHO.ZDL': 7, 'MODDLY.ZDL': 8, 'PITCHDLY.ZDL': 9,
  'DUALDIGD.ZDL': 17, 'SLAPBKD.ZDL': 14,
  'ROOM.ZDL': 10, 'AIR.ZDL': 6, 'HDHALL.ZDL': 26, 'HALL.ZDL': 11, 'SPRING.ZDL': 9, 'EARLYREF.ZDL': 10, 'PLATE.ZDL': 21,
  'CHURCH.ZDL': 30, 'SPC_HOLE.ZDL': 29, 'PARTICLE.ZDL': 38, 'AMBIENCE.ZDL': 29,
  // guitar amps (cabinet is extra, see CAB_COST)
  'MS_1959.ZDL': 31, 'MSCRUNCH.ZDL': 30, 'US_BLUES.ZDL': 30, 'FDCOMBO.ZDL': 30, 'VX_COMBO.ZDL': 37, 'DELUXE_R.ZDL': 30,
  'HW_STACK.ZDL': 28, 'DZ_DRIVE.ZDL': 26,
};

/** Catalog effects that are not installed as files on every pedal but are in Zoom's chart. */
const CHART_BY_FXID: Record<number, number> = {
  0x01000030: 13, // OptComp
  0x02000030: 9, // Exciter
  0x060000a0: 7, // StereoCho
  0x06000120: 7, // PitchSHFT
  0x060001a0: 8, // StonePha
};

const CATEGORY_TYPICAL: Record<EffectCategory, number> = {
  comp: 8, pedal: 8, drive: 16, amp: 30, mod: 8, delay: 8, reverb: 20,
};

/** Every guitar-amp cabinet costs the same in Zoom's chart. */
export const CAB_COST = 9;
/** Zoom's chart treats 100 as the most a patch can use ("Overflow Process" beyond that). */
export const DSP_LIMIT = 100;

const BY_FXID = new Map<number, number>();
for (const e of INSTALLED_EFFECTS) {
  const v = CHART_BY_FILE[e.file];
  if (v !== undefined) BY_FXID.set(e.fxid, v);
}
for (const [k, v] of Object.entries(CHART_BY_FXID)) if (!BY_FXID.has(Number(k))) BY_FXID.set(Number(k), v);

export interface SlotDsp {
  cost: number;
  /** true when the number comes from Zoom's chart, false when estimated from the effect's category. */
  fromChart: boolean;
  cab: number;
}

export function slotDsp(slot: Pick<PedalSlotState, 'fxid' | 'params'>): SlotDsp {
  const chart = BY_FXID.get(slot.fxid);
  const def = getEffectDefinition(slot.fxid);
  const base = chart ?? (def ? CATEGORY_TYPICAL[def.category] : 12);
  const cab = isGuitarAmpFxid(slot.fxid) && (slot.params[7] ?? 0) !== 0 ? CAB_COST : 0;
  return { cost: base + cab, fromChart: chart !== undefined, cab };
}

export interface RigDsp {
  slots: SlotDsp[];
  total: number;
  /** false if any slot was estimated from its category. */
  exact: boolean;
}

/** All pedals use DSP whether they are on or off, and all four scenes share the same effects, so one total per rig. */
export function rigDsp(rig: GigRig): RigDsp {
  const slots = rig.scenes.A.map((s) => slotDsp(s));
  return { slots, total: slots.reduce((n, s) => n + s.cost, 0), exact: slots.every((s) => s.fromChart) };
}
