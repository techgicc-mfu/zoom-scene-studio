import { GigRig, PedalChain5, PedalSlotState } from '../types/rig';

function slot(enabled: boolean, fxid: number, params: number[]): PedalSlotState {
  const padded = [...params];
  while (padded.length < 9) padded.push(0);
  return { enabled, fxid, params: padded.slice(0, 9) };
}

function cloneChain(chain: PedalChain5): PedalChain5 {
  return chain.map((s) => ({
    enabled: s.enabled,
    fxid: s.fxid,
    params: [...s.params],
  })) as PedalChain5;
}

export interface StarterTemplate {
  id: string;
  title: string;
  genreTag: string;
  summary: string;
  createRig: (index: number) => GigRig;
}

export const STARTER_TEMPLATES: StarterTemplate[] = [
  {
    id: 'classic-rock-plexi',
    title: 'Classic Rock Plexi',
    genreTag: '70s / 80s Classic Rock',
    summary: 'Crybaby Wah + TS Drive into a roaring 1959 Marshall Plexi, Analog Delay & Studio Plate.',
    createRig: (index: number): GigRig => {
      const sceneA: PedalChain5 = [
        slot(false, 0x0015, [50, 7, 100]),                // Crybaby Wah (OFF on rhythm)
        slot(false, 0x0021, [42, 56, 100]),               // TS Drive (OFF on cleanish A)
        slot(true, 0x0048, [30, 58, 95, 58, 60, 48]),     // MS 1959 Plexi (rolled-back clean)
        slot(false, 0x0081, [360, 28, 24]),               // Analog Delay
        slot(true, 0x00a3, [28, 7, 20, 20]),              // Studio Plate Reverb
      ];
      const sceneB = cloneChain(sceneA);
      sceneB[2].params[0] = 62;                           // Plexi Gain -> 62 (Classic Crunch!)

      const sceneC = cloneChain(sceneB);
      sceneC[1].enabled = true;                           // TS Drive ON
      sceneC[1].params[0] = 55;
      sceneC[2].params[0] = 74;                           // Plexi Gain -> 74
      sceneC[2].params[2] = 104;                          // Amp Level boost
      sceneC[3].enabled = true;                           // Analog Delay ON for solo
      sceneC[3].params[1] = 34;
      sceneC[3].params[2] = 30;

      const sceneD = cloneChain(sceneA);
      sceneD[2].params[0] = 24;                           // Sparkly Ballad Clean
      sceneD[3].enabled = true;
      sceneD[3].params[2] = 32;
      sceneD[4].params[0] = 58;                           // Deeper Plate Decay
      sceneD[4].params[2] = 36;

      return {
        index,
        name: index === 0 ? 'Classic Rock Plexi' : `Rock Plexi ${index + 1}`,
        tempo: 120,
        sceneNames: {
          A: 'Rolled Clean',
          B: 'Plexi Crunch',
          C: 'Singing Solo',
          D: 'Ballad Wash',
        },
        sceneTrims: { A: 12, B: 12, C: 17, D: 12 }, // +2.5 dB boost on Scene C
        scenes: { A: sceneA, B: sceneB, C: sceneC, D: sceneD },
        expression: {
          targetSlot: 2, // Slot 2 = Crybaby Wah Freq (or user can flip Wah ON & rock VP-1)
          targetParam: 1,
          minPct: 5,
          maxPct: 95,
          curve: 'vp1',
        },
      };
    },
  },
  {
    id: 'texas-blues-combo',
    title: 'Texas Blues Combo',
    genreTag: 'Blues & Roots',
    summary: 'RC Boost + Tube Screamer into a 65 Deluxe Combo, Vintage Tremolo & 63 Spring Reverb.',
    createRig: (index: number): GigRig => {
      const sceneA: PedalChain5 = [
        slot(true, 0x0001, [5, 6, 100]),                  // Dyna Comp
        slot(false, 0x0021, [45, 54, 102]),               // TS Drive
        slot(true, 0x0042, [34, 55, 96, 56, 52, 48]),     // Deluxe-R Clean
        slot(false, 0x0064, [58, 22, 15]),                // Vintage Tremolo
        slot(true, 0x00a1, [11, 6, 22]),                  // 63 Spring Reverb
      ];
      const sceneB = cloneChain(sceneA);
      sceneB[0].enabled = false;
      sceneB[1].enabled = true;                           // TS Drive ON (Edge of breakup)
      sceneB[1].params[0] = 40;
      sceneB[2].params[0] = 48;

      const sceneC = cloneChain(sceneB);
      sceneC[0].enabled = true;                           // Comp + TS stacked into Deluxe!
      sceneC[1].params[0] = 72;
      sceneC[2].params[0] = 60;
      sceneC[2].params[2] = 105;
      sceneC[4].params[2] = 28;

      const sceneD = cloneChain(sceneA);
      sceneD[3].enabled = true;                           // Swampy Tube Tremolo + Deep Spring
      sceneD[4].params[0] = 18;
      sceneD[4].params[2] = 35;

      return {
        index,
        name: index === 1 ? 'Texas Blues Combo' : `Blues Combo ${index + 1}`,
        tempo: 96,
        sceneNames: {
          A: 'Spanky Clean',
          B: 'SRV Grit',
          C: 'Texas Lead',
          D: 'Tremolo Blues',
        },
        sceneTrims: { A: 12, B: 12, C: 16, D: 13 },
        scenes: { A: sceneA, B: sceneB, C: sceneC, D: sceneD },
        expression: {
          targetSlot: 4, // Deluxe-R Amp Gain controlled by foot!
          targetParam: 1,
          minPct: 25,
          maxPct: 78,
          curve: 'vp1',
        },
      };
    },
  },
  {
    id: '80s-pop-studio',
    title: '80s Pop Clean',
    genreTag: 'Pop & Funk',
    summary: 'Rack Comp + Gold Drive + Fender Twin + Stereo CE Chorus + Tape Echo.',
    createRig: (index: number): GigRig => {
      const sceneA: PedalChain5 = [
        slot(true, 0x0002, [34, 4, 105]),                 // Rack Comp
        slot(false, 0x0022, [42, 58, 105]),               // Centaur Gold Drive
        slot(true, 0x0041, [26, 50, 96, 62, 50, 50]),     // FD Combo sparkling clean
        slot(false, 0x0061, [54, 22, 50, 7]),             // Stereo CE Chorus
        slot(true, 0x0083, [380, 26, 18, 6]),             // Subtle Tape Echo
      ];
      const sceneB = cloneChain(sceneA);
      sceneB[3].enabled = true;                           // Lush 80s Chorus Shimmer
      sceneB[4].params[2] = 28;

      const sceneC = cloneChain(sceneA);
      sceneC[1].enabled = true;                           // Pop-Rock Chorus Hook Drive
      sceneC[1].params[0] = 52;
      sceneC[2].params[0] = 44;

      const sceneD = cloneChain(sceneC);
      sceneD[1].params[0] = 78;                           // 80s Arena Solo
      sceneD[3].enabled = true;
      sceneD[3].params[2] = 35;
      sceneD[4].params[1] = 44;
      sceneD[4].params[2] = 36;

      return {
        index,
        name: index === 2 ? '80s Pop Clean' : `80s Pop ${index + 1}`,
        tempo: 116,
        sceneNames: {
          A: 'Tight Funk',
          B: 'Lush Chorus',
          C: 'Pop Drive',
          D: 'Arena Solo',
        },
        sceneTrims: { A: 12, B: 12, C: 13, D: 17 },
        scenes: { A: sceneA, B: sceneB, C: sceneC, D: sceneD },
        expression: {
          targetSlot: 5, // CE Chorus Mix
          targetParam: 3,
          minPct: 0,
          maxPct: 65,
          curve: 'vp1',
        },
      };
    },
  },
  {
    id: 'sunday-service-ambient',
    title: 'Sunday Worship',
    genreTag: 'Sunday Service & Ambient',
    summary: 'Rack Comp + Sweet Drive + Vox AC30 Chime + Mod Dotted-8th Delay + Lush HD Hall Swells.',
    createRig: (index: number): GigRig => {
      const sceneA: PedalChain5 = [
        slot(true, 0x0002, [32, 4, 104]),                 // Rack Comp
        slot(false, 0x0024, [38, 54, 102]),               // Sweet Drive (Blues Breaker)
        slot(true, 0x0045, [34, 55, 95, 60, 50, 48]),     // VX Combo (AC30 Chime)
        slot(true, 0x0086, [375, 30, 22, 22]),            // Mod Delay (constant 375ms time!)
        slot(true, 0x00a5, [42, 7, 26, 30]),              // HD Hall Reverb
      ];
      const sceneB = cloneChain(sceneA);
      sceneB[1].enabled = true;                           // Praise Chorus Rhythm + Dotted-8th
      sceneB[1].params[0] = 44;
      sceneB[3].params[1] = 44;                           // Delay Fbk -> 44%
      sceneB[3].params[2] = 36;                           // Delay Mix -> 36%
      sceneB[4].params[0] = 55;                           // Hall Decay -> 55

      const sceneC = cloneChain(sceneB);
      sceneC[1].params[0] = 68;                           // Soaring Worship Anthem Lead
      sceneC[2].params[0] = 52;
      sceneC[3].params[1] = 48;
      sceneC[3].params[2] = 40;
      sceneC[4].params[0] = 68;
      sceneC[4].params[2] = 38;

      const sceneD = cloneChain(sceneA);
      sceneD[1].enabled = false;                          // Prayer / Pad Ambient Swell
      sceneD[2].params[0] = 30;
      sceneD[3].params[1] = 62;                           // Deep repeating delay cloud
      sceneD[3].params[2] = 48;
      sceneD[4].params[0] = 86;                           // Huge 86% Concert Hall Decay!
      sceneD[4].params[2] = 62;                           // Lush 62% Hall Wet Mix!

      return {
        index,
        name: index === 3 ? 'Sunday Worship' : `Worship Rig ${index + 1}`,
        tempo: 120,
        sceneNames: {
          A: 'Clean Verse',
          B: 'Praise Drive',
          C: 'Soaring Lead',
          D: 'Sunday Swell',
        },
        sceneTrims: { A: 12, B: 12, C: 16, D: 13 },
        scenes: { A: sceneA, B: sceneB, C: sceneC, D: sceneD },
        expression: {
          targetSlot: 6, // Slot 6 = HD Hall Reverb Mix (20% -> 80% smooth worship swell!)
          targetParam: 3,
          minPct: 20,
          maxPct: 80,
          curve: 'swell',
        },
      };
    },
  },
];

export function createDefault12Rigs(): GigRig[] {
  return Array.from({ length: 12 }, (_, idx) =>
    STARTER_TEMPLATES[idx % STARTER_TEMPLATES.length].createRig(idx)
  );
}
