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
        slot(false, 0x02000070, [6, 8, 12, 100, 100]),          // Cry Wah (OFF on rhythm)
        slot(false, 0x03000170, [45, 57, 82]),                  // TS Drive (OFF on cleanish A)
        slot(true, 0x040000f0, [30, 58, 95, 58, 60, 48, 50]),   // MS 1959 Plexi (rolled-back clean)
        slot(false, 0x08000030, [360, 28, 24, 8, 0, 100, 0]),   // AnalogDly
        slot(true, 0x09000090, [8, 28, 20, 58, 97, 95, 0, 100]),// Studio Plate Reverb
      ];
      const sceneB = cloneChain(sceneA);
      sceneB[2].params[0] = 62; // Plexi Gain -> 62 (Classic Crunch!)

      const sceneC = cloneChain(sceneB);
      sceneC[1].enabled = true; // TS Drive ON
      sceneC[1].params[0] = 65;
      sceneC[2].params[0] = 74; // Plexi Gain -> 74
      sceneC[2].params[2] = 104; // Amp Level boost
      sceneC[3].enabled = true; // Analog Delay ON for solo
      sceneC[3].params[1] = 34;
      sceneC[3].params[2] = 30;

      const sceneD = cloneChain(sceneA);
      sceneD[2].params[0] = 24; // Sparkly Ballad Clean
      sceneD[3].enabled = true;
      sceneD[3].params[2] = 32;
      sceneD[4].params[1] = 58; // Deeper Plate Decay (param index 1)
      sceneD[4].params[2] = 36; // Deeper Plate Mix (param index 2)

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
          targetSlot: 2, // Cry Wah Sense / sweep
          targetParam: 3,
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
    summary: 'Comp + Tube Screamer into a 65 Deluxe Combo, Vintage Tremolo & 63 Spring Reverb.',
    createRig: (index: number): GigRig => {
      const sceneA: PedalChain5 = [
        slot(true, 0x01000008, [5, 6, 100, 0]),                 // Comp
        slot(false, 0x03000170, [45, 54, 86]),                  // TS Drive
        slot(true, 0x04000010, [34, 55, 96, 56, 52, 48, 50]),   // Deluxe-R Clean
        slot(false, 0x06000008, [65, 33, 125, 21]),             // Vintage Tremolo
        slot(true, 0x090000c0, [28, 32, 58, 100]),              // 63 Spring Reverb
      ];
      const sceneB = cloneChain(sceneA);
      sceneB[0].enabled = false;
      sceneB[1].enabled = true; // TS Drive ON (Edge of breakup)
      sceneB[1].params[0] = 40;
      sceneB[2].params[0] = 48;

      const sceneC = cloneChain(sceneB);
      sceneC[0].enabled = true; // Comp + TS stacked into Deluxe!
      sceneC[1].params[0] = 72;
      sceneC[2].params[0] = 60;
      sceneC[2].params[2] = 105;
      sceneC[4].params[1] = 38;

      const sceneD = cloneChain(sceneA);
      sceneD[3].enabled = true; // Swampy Tube Tremolo + Deep Spring
      sceneD[4].params[0] = 52;
      sceneD[4].params[1] = 45;

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
    summary: 'Rack Comp + Centaur Gold + Fender Twin + Stereo Chorus + Tape Echo.',
    createRig: (index: number): GigRig => {
      const sceneA: PedalChain5 = [
        slot(true, 0x01000010, [34, 4, 105, 6]),                // Rack Comp
        slot(false, 0x03000150, [42, 58, 70]),                  // CentaGold
        slot(true, 0x04000008, [26, 50, 96, 62, 50, 50, 52]),   // FD Combo sparkling clean
        slot(false, 0x060000a0, [54, 22, 50, 7, 100]),          // Stereo Chorus
        slot(true, 0x08000010, [380, 26, 22, 6, 100, 0]),       // Subtle Tape Echo
      ];
      const sceneB = cloneChain(sceneA);
      sceneB[3].enabled = true; // Lush 80s Chorus Shimmer
      sceneB[4].params[2] = 32;

      const sceneC = cloneChain(sceneA);
      sceneC[1].enabled = true; // Pop-Rock Chorus Hook Drive
      sceneC[1].params[0] = 52;
      sceneC[2].params[0] = 44;

      const sceneD = cloneChain(sceneC);
      sceneD[1].params[0] = 78; // 80s Arena Solo
      sceneD[3].enabled = true;
      sceneD[3].params[2] = 40;
      sceneD[4].params[1] = 44;
      sceneD[4].params[2] = 38;

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
          targetSlot: 5, // Stereo Chorus Mix
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
        slot(true, 0x01000010, [32, 4, 104, 5]),                // Rack Comp
        slot(false, 0x030001d0, [62, 65, 38]),                  // SweetDrv
        slot(true, 0x04000040, [34, 55, 95, 60, 50, 48, 53]),   // VX Combo (AC30 Chime)
        slot(true, 0x08000020, [375, 30, 22, 22, 100, 0]),      // Mod Delay (constant 375ms time!)
        slot(true, 0x09000008, [65, 42, 26, 32, 70, 0]),        // HD Hall Reverb
      ];
      const sceneB = cloneChain(sceneA);
      sceneB[1].enabled = true; // Praise Chorus Rhythm + Dotted-8th
      sceneB[1].params[2] = 52;
      sceneB[3].params[1] = 44; // Delay Fbk -> 44%
      sceneB[3].params[2] = 36; // Delay Mix -> 36%
      sceneB[4].params[1] = 55; // Hall Decay -> 55

      const sceneC = cloneChain(sceneB);
      sceneC[1].params[2] = 74; // Soaring Worship Anthem Lead
      sceneC[2].params[0] = 52;
      sceneC[3].params[1] = 48;
      sceneC[3].params[2] = 40;
      sceneC[4].params[1] = 68;
      sceneC[4].params[2] = 38;

      const sceneD = cloneChain(sceneA);
      sceneD[1].enabled = false; // Prayer / Pad Ambient Swell
      sceneD[2].params[0] = 30;
      sceneD[3].params[1] = 62; // Deep repeating delay cloud
      sceneD[3].params[2] = 48;
      sceneD[4].params[1] = 86; // Huge 86 Concert Hall Decay!
      sceneD[4].params[2] = 62; // Lush 62% Hall Wet Mix!

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
