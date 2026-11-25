import { EffectCategory, EffectDefinition } from '../types/rig';

export const SCENE_ZDL_FXID = 0x0195; // 405

export const CATEGORY_META: Record<
  EffectCategory,
  { label: string; color: string; badgeBg: string }
> = {
  comp: { label: 'Comp & Boost', color: '#38bdf8', badgeBg: '#0c4a6e' },
  pedal: { label: 'Wah & Pitch Pedal', color: '#f97316', badgeBg: '#7c2d12' },
  drive: { label: 'Overdrive & Fuzz', color: '#eab308', badgeBg: '#713f12' },
  amp: { label: 'Guitar Amps', color: '#ef4444', badgeBg: '#7f1d1d' },
  mod: { label: 'Chorus & Modulation', color: '#06b6d4', badgeBg: '#164e63' },
  delay: { label: 'Echo & Delay', color: '#10b981', badgeBg: '#064e3b' },
  reverb: { label: 'Hall, Spring & Shimmer', color: '#a855f7', badgeBg: '#581c87' },
};

/**
 * Curated catalog of ~32 essential Classic Rock, Blues, Pop, and Sunday Service effects
 * for Zoom MS-50G / MIDISTOMP V2.0. Uncatalogued fxids on the pedal are preserved losslessly.
 */
export const EFFECT_CATALOG: EffectDefinition[] = [
  // Comp & Boost
  {
    fxid: 0x0001,
    name: 'Dyna Comp',
    shortName: 'Comp',
    category: 'comp',
    description: 'Classic Ross/MXR-style squeeze for country, pop, and clean sustain.',
    params: [
      { name: 'Sense', min: 0, max: 10, defaultValue: 6 },
      { name: 'Tone', min: 0, max: 10, defaultValue: 6 },
      { name: 'Level', min: 0, max: 150, defaultValue: 100 },
    ],
  },
  {
    fxid: 0x0002,
    name: 'Rack Comp',
    shortName: 'RackComp',
    category: 'comp',
    description: 'Smooth studio optical/rack compressor ideal for 80s pop & Sunday worship.',
    params: [
      { name: 'Thrsh', min: 0, max: 50, defaultValue: 32 },
      { name: 'Ratio', min: 1, max: 10, defaultValue: 4 },
      { name: 'Level', min: 0, max: 150, defaultValue: 105 },
    ],
  },
  {
    fxid: 0x0008,
    name: 'RC Clean Boost',
    shortName: 'Booster',
    category: 'comp',
    description: 'Transparent Xotic RC-style clean boost with Bass & Treble shaping.',
    params: [
      { name: 'Gain', min: 0, max: 100, defaultValue: 35 },
      { name: 'Bass', min: 0, max: 100, defaultValue: 50 },
      { name: 'Treble', min: 0, max: 100, defaultValue: 55 },
      { name: 'Volume', min: 0, max: 100, defaultValue: 75 },
    ],
  },
  {
    fxid: 0x000c,
    name: 'ZNR Noise Gate',
    shortName: 'ZNR',
    category: 'comp',
    description: 'Zoom Noise Reduction — tames single-coil hum and high-gain hiss.',
    params: [
      { name: 'Thrsh', min: 0, max: 25, defaultValue: 10 },
      { name: 'Decay', min: 0, max: 100, defaultValue: 20 },
    ],
  },

  // Wah & Expression Effects (Great for Salfini VP-1!)
  {
    fxid: 0x0015,
    name: 'Crybaby Wah',
    shortName: 'Cry Wah',
    category: 'pedal',
    description: 'Classic vocal wah — map Salfini VP-1 to "Freq" for wireless foot wah!',
    params: [
      { name: 'Freq', min: 0, max: 100, defaultValue: 50 },
      { name: 'Reso', min: 0, max: 10, defaultValue: 7 },
      { name: 'Level', min: 0, max: 150, defaultValue: 100 },
    ],
  },
  {
    fxid: 0x0018,
    name: 'Pedal Pitch (Whammy)',
    shortName: 'PdlPitch',
    category: 'pedal',
    description: '+1 Octave pitch glide — map Salfini VP-1 to "Pedal" for Whammy leads!',
    params: [
      { name: 'Pedal', min: 0, max: 100, defaultValue: 0 },
      { name: 'Shift', min: 0, max: 15, defaultValue: 7 },
      { name: 'Tone', min: 0, max: 10, defaultValue: 7 },
    ],
  },

  // Overdrive & Fuzz
  {
    fxid: 0x0021,
    name: 'T-Scream (TS808)',
    shortName: 'TS Drive',
    category: 'drive',
    description: 'Warm mid-humped green Tube Screamer for Texas Blues & tightening amps.',
    params: [
      { name: 'Gain', min: 0, max: 100, defaultValue: 45 },
      { name: 'Tone', min: 0, max: 100, defaultValue: 55 },
      { name: 'Level', min: 0, max: 150, defaultValue: 100 },
    ],
  },
  {
    fxid: 0x0022,
    name: 'Centaur Gold (Klon)',
    shortName: 'GoldDrv',
    category: 'drive',
    description: 'Transparent Klon Centaur overdrive — magic for edge-of-breakup & worship.',
    params: [
      { name: 'Gain', min: 0, max: 100, defaultValue: 38 },
      { name: 'Treble', min: 0, max: 100, defaultValue: 58 },
      { name: 'Out', min: 0, max: 150, defaultValue: 105 },
    ],
  },
  {
    fxid: 0x0024,
    name: 'Blues Breaker OD',
    shortName: 'SweetDrv',
    category: 'drive',
    description: 'Open, touch-sensitive low-gain overdrive for Blues & Sunday rhythm.',
    params: [
      { name: 'Gain', min: 0, max: 100, defaultValue: 42 },
      { name: 'Tone', min: 0, max: 100, defaultValue: 52 },
      { name: 'Level', min: 0, max: 150, defaultValue: 100 },
    ],
  },
  {
    fxid: 0x0026,
    name: 'Guvnor Crunch',
    shortName: 'Guvnor',
    category: 'drive',
    description: 'British Marshall-in-a-box crunch distortion for 70s/80s Classic Rock.',
    params: [
      { name: 'Gain', min: 0, max: 100, defaultValue: 65 },
      { name: 'Bass', min: 0, max: 100, defaultValue: 55 },
      { name: 'Mid', min: 0, max: 100, defaultValue: 60 },
      { name: 'Treble', min: 0, max: 100, defaultValue: 58 },
      { name: 'Level', min: 0, max: 150, defaultValue: 95 },
    ],
  },
  {
    fxid: 0x0029,
    name: 'Squeak (ProCo RAT)',
    shortName: 'Squeak',
    category: 'drive',
    description: 'Fat, singing distortion that cuts through any band mix for solos.',
    params: [
      { name: 'Gain', min: 0, max: 100, defaultValue: 60 },
      { name: 'Filter', min: 0, max: 100, defaultValue: 50 },
      { name: 'Level', min: 0, max: 150, defaultValue: 95 },
    ],
  },
  {
    fxid: 0x002c,
    name: 'NYC Muff Fuzz',
    shortName: 'NYC Muff',
    category: 'drive',
    description: 'Violin-like Gilmour sustain fuzz for Pink Floyd & soaring leads.',
    params: [
      { name: 'Sustain', min: 0, max: 100, defaultValue: 68 },
      { name: 'Tone', min: 0, max: 100, defaultValue: 54 },
      { name: 'Balance', min: 0, max: 150, defaultValue: 95 },
    ],
  },

  // Guitar Amps
  {
    fxid: 0x0041,
    name: 'FD Combo (Fender Twin)',
    shortName: 'FD Combo',
    category: 'amp',
    description: 'Sparkling American 2x12 clean & blues breakup platform.',
    params: [
      { name: 'Gain', min: 0, max: 100, defaultValue: 32 },
      { name: 'Tube', min: 0, max: 100, defaultValue: 50 },
      { name: 'Level', min: 0, max: 150, defaultValue: 95 },
      { name: 'Treble', min: 0, max: 100, defaultValue: 58 },
      { name: 'Middle', min: 0, max: 100, defaultValue: 50 },
      { name: 'Bass', min: 0, max: 100, defaultValue: 52 },
    ],
  },
  {
    fxid: 0x0042,
    name: 'Deluxe-R (65 Deluxe)',
    shortName: 'Deluxe-R',
    category: 'amp',
    description: 'Sweet 22W club combo — cleans up with guitar volume, barks when pushed.',
    params: [
      { name: 'Gain', min: 0, max: 100, defaultValue: 44 },
      { name: 'Tube', min: 0, max: 100, defaultValue: 55 },
      { name: 'Level', min: 0, max: 150, defaultValue: 95 },
      { name: 'Treble', min: 0, max: 100, defaultValue: 56 },
      { name: 'Middle', min: 0, max: 100, defaultValue: 52 },
      { name: 'Bass', min: 0, max: 100, defaultValue: 48 },
    ],
  },
  {
    fxid: 0x0045,
    name: 'VX Combo (Vox AC30)',
    shortName: 'VX Combo',
    category: 'amp',
    description: 'Chimey Top-Boost British Class-A combo — classic Pop & Sunday Worship staple.',
    params: [
      { name: 'Gain', min: 0, max: 100, defaultValue: 40 },
      { name: 'Tube', min: 0, max: 100, defaultValue: 55 },
      { name: 'Level', min: 0, max: 150, defaultValue: 95 },
      { name: 'Treble', min: 0, max: 100, defaultValue: 60 },
      { name: 'Middle', min: 0, max: 100, defaultValue: 50 },
      { name: 'Bass', min: 0, max: 100, defaultValue: 48 },
    ],
  },
  {
    fxid: 0x0048,
    name: 'MS 1959 (Marshall Plexi)',
    shortName: 'MS Plexi',
    category: 'amp',
    description: 'Legendary 1959 Super Lead Plexi roar for Classic Rock rhythm & solos.',
    params: [
      { name: 'Gain', min: 0, max: 100, defaultValue: 56 },
      { name: 'Tube', min: 0, max: 100, defaultValue: 60 },
      { name: 'Level', min: 0, max: 150, defaultValue: 92 },
      { name: 'Treble', min: 0, max: 100, defaultValue: 58 },
      { name: 'Middle', min: 0, max: 100, defaultValue: 62 },
      { name: 'Bass', min: 0, max: 100, defaultValue: 50 },
    ],
  },
  {
    fxid: 0x0049,
    name: 'MS Crunch (JCM800)',
    shortName: 'MS800',
    category: 'amp',
    description: 'Punchy 80s British master-volume rock crunch and singing leads.',
    params: [
      { name: 'Gain', min: 0, max: 100, defaultValue: 64 },
      { name: 'Tube', min: 0, max: 100, defaultValue: 55 },
      { name: 'Level', min: 0, max: 150, defaultValue: 90 },
      { name: 'Treble', min: 0, max: 100, defaultValue: 56 },
      { name: 'Middle', min: 0, max: 100, defaultValue: 60 },
      { name: 'Bass', min: 0, max: 100, defaultValue: 52 },
    ],
  },

  // Chorus & Modulation
  {
    fxid: 0x0061,
    name: 'Stereo CE Chorus',
    shortName: 'CE-Cho',
    category: 'mod',
    description: 'Lush Boss CE-1/CE-2 style chorus for 80s Pop cleans and wide worship.',
    params: [
      { name: 'Depth', min: 0, max: 100, defaultValue: 52 },
      { name: 'Rate', min: 1, max: 50, defaultValue: 22 },
      { name: 'Mix', min: 0, max: 100, defaultValue: 48 },
      { name: 'Tone', min: 0, max: 10, defaultValue: 7 },
    ],
  },
  {
    fxid: 0x0064,
    name: 'Vintage Tremolo',
    shortName: 'Tremolo',
    category: 'mod',
    description: 'Warm tube-bias amp tremolo pulse for swamp blues & roots rock.',
    params: [
      { name: 'Depth', min: 0, max: 100, defaultValue: 62 },
      { name: 'Rate', min: 0, max: 50, defaultValue: 24 },
      { name: 'Wave', min: 0, max: 30, defaultValue: 15 },
    ],
  },
  {
    fxid: 0x0067,
    name: 'Phase 90 Stone',
    shortName: 'Phaser',
    category: 'mod',
    description: 'Swirling 4-stage analog phaser for classic rock riffs & funk.',
    params: [
      { name: 'Rate', min: 0, max: 50, defaultValue: 18 },
      { name: 'Color', min: 0, max: 1, defaultValue: 1 },
      { name: 'Level', min: 0, max: 150, defaultValue: 100 },
    ],
  },
  {
    fxid: 0x006b,
    name: 'Uni-Vibe',
    shortName: 'TheVibe',
    category: 'mod',
    description: 'Throbbing photocell rotary chorus/vibrato (Hendrix / Trower / Gilmour).',
    params: [
      { name: 'Speed', min: 0, max: 50, defaultValue: 24 },
      { name: 'Depth', min: 0, max: 100, defaultValue: 65 },
      { name: 'Bias', min: 0, max: 100, defaultValue: 50 },
    ],
  },

  // Delays
  {
    fxid: 0x0081,
    name: 'Analog Delay (DM-2)',
    shortName: 'AnalogDly',
    category: 'delay',
    description: 'Warm bucket-brigade repeats that sit tucked behind solos without clutter.',
    params: [
      { name: 'Time', min: 1, max: 3000, defaultValue: 360, unit: 'ms', warnOnSceneDiff: true },
      { name: 'F.B', min: 0, max: 100, defaultValue: 28, unit: '%' },
      { name: 'Mix', min: 0, max: 100, defaultValue: 26, unit: '%' },
    ],
  },
  {
    fxid: 0x0083,
    name: 'Tape Echo',
    shortName: 'TapeEcho',
    category: 'delay',
    description: 'Organic vintage tape echo with warm high-end roll-off for Blues & Worship.',
    params: [
      { name: 'Time', min: 1, max: 2000, defaultValue: 420, unit: 'ms', warnOnSceneDiff: true },
      { name: 'F.B', min: 0, max: 100, defaultValue: 38, unit: '%' },
      { name: 'Mix', min: 0, max: 100, defaultValue: 34, unit: '%' },
      { name: 'HiDmp', min: 0, max: 10, defaultValue: 6 },
    ],
  },
  {
    fxid: 0x0086,
    name: 'Modulation Delay',
    shortName: 'ModDelay',
    category: 'delay',
    description: '2290/Memory-Man style chorused delay repeats — iconic for U2 / Worship dotted-8ths.',
    params: [
      { name: 'Time', min: 1, max: 2000, defaultValue: 375, unit: 'ms', warnOnSceneDiff: true },
      { name: 'F.B', min: 0, max: 100, defaultValue: 42, unit: '%' },
      { name: 'Mix', min: 0, max: 100, defaultValue: 38, unit: '%' },
      { name: 'Depth', min: 0, max: 50, defaultValue: 24 },
    ],
  },

  // Reverbs
  {
    fxid: 0x00a1,
    name: '63 Spring Reverb',
    shortName: 'Spring',
    category: 'reverb',
    description: 'Drip and bounce of a vintage tube amp spring tank for Blues & Surf.',
    params: [
      { name: 'Decay', min: 1, max: 30, defaultValue: 12 },
      { name: 'Tone', min: 0, max: 10, defaultValue: 6 },
      { name: 'Mix', min: 0, max: 100, defaultValue: 24, unit: '%' },
    ],
  },
  {
    fxid: 0x00a3,
    name: 'Studio Plate Reverb',
    shortName: 'Plate',
    category: 'reverb',
    description: 'Smooth studio vocal/guitar plate reverb for Classic Rock & Pop mixes.',
    params: [
      { name: 'Decay', min: 1, max: 100, defaultValue: 38 },
      { name: 'Tone', min: 0, max: 10, defaultValue: 7 },
      { name: 'Mix', min: 0, max: 100, defaultValue: 28, unit: '%' },
      { name: 'PreD', min: 1, max: 100, defaultValue: 25, unit: 'ms' },
    ],
  },
  {
    fxid: 0x00a5,
    name: 'HD Hall Reverb',
    shortName: 'HD Hall',
    category: 'reverb',
    description: 'Deep, lush concert hall reverb — crank Decay & Mix for Sunday Service pads.',
    params: [
      { name: 'Decay', min: 1, max: 100, defaultValue: 55 },
      { name: 'Tone', min: 0, max: 10, defaultValue: 7 },
      { name: 'Mix', min: 0, max: 100, defaultValue: 35, unit: '%' },
      { name: 'PreD', min: 1, max: 100, defaultValue: 30, unit: 'ms' },
    ],
  },
  {
    fxid: 0x00a9,
    name: 'Shimmer Reverb',
    shortName: 'Shimmer',
    category: 'reverb',
    description: 'Octave-up angelic ambient bloom for worship intros and swells.',
    params: [
      { name: 'Decay', min: 1, max: 100, defaultValue: 78 },
      { name: 'Pitch', min: 0, max: 100, defaultValue: 50 },
      { name: 'Mix', min: 0, max: 100, defaultValue: 45, unit: '%' },
    ],
  },
];

export const EFFECT_BY_ID: Map<number, EffectDefinition> = new Map(
  EFFECT_CATALOG.map((fx) => [fx.fxid, fx])
);

export function getEffectDefinition(fxid: number): EffectDefinition | undefined {
  return EFFECT_BY_ID.get(fxid);
}
