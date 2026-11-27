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
        slot(true, 0x040000f0, [30, 58, 95, 58, 60, 48, 50, 1, 0]),   // MS 1959 Plexi (CAB ON, LINE)
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
        slot(true, 0x04000010, [34, 55, 96, 56, 52, 48, 50, 1, 0]),   // Deluxe-R Clean (CAB ON, LINE)
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
        slot(true, 0x04000008, [26, 50, 96, 62, 50, 50, 52, 1, 0]),   // FD Combo sparkling clean (CAB ON, LINE)
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
        slot(true, 0x04000040, [34, 55, 95, 60, 50, 48, 53, 1, 0]),   // VX Combo (AC30 Chime, CAB ON, LINE)
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
  {
    id: 'modern-metal-tight',
    title: 'Modern Metal',
    genreTag: 'Metal & Hard Rock',
    summary: 'ZNR Gate + TS boost into a HW Stack high-gain stack, tight Digital Delay & Studio Plate.',
    createRig: (index: number): GigRig => {
      const sceneA: PedalChain5 = [
        slot(true, 0x01000050, [12, 1, 100]),                          // ZNR gate (tames high-gain hiss)
        slot(false, 0x03000170, [22, 62, 92]),                         // TS Drive as a tight boost (OFF on rhythm A)
        slot(true, 0x040000b0, [62, 30, 100, 48, 38, 54, 55, 1, 0]),   // HW Stack (CAB ON, LINE)
        slot(false, 0x08000008, [420, 24, 20, 6, 0, 100, 0]),          // Digital Delay
        slot(true, 0x09000090, [8, 25, 14, 58, 97, 95, 0, 100]),       // Studio Plate (short)
      ];
      const sceneB = cloneChain(sceneA);
      sceneB[1].enabled = true; // Boost ON: tight chugs
      sceneB[2].params[0] = 70;
      sceneB[2].params[5] = 58; // more low end

      const sceneC = cloneChain(sceneB);
      sceneC[1].params[0] = 40; // Lead boost
      sceneC[2].params[0] = 78;
      sceneC[2].params[2] = 106; // Level lift
      sceneC[3].enabled = true;
      sceneC[3].params[2] = 28;

      const sceneD = cloneChain(sceneA);
      sceneD[0].enabled = false; // Clean intro: gate off
      sceneD[2].params[0] = 20;
      sceneD[2].params[2] = 96;
      sceneD[3].enabled = true;
      sceneD[3].params[1] = 40;
      sceneD[3].params[2] = 34;
      sceneD[4].params[1] = 48;
      sceneD[4].params[2] = 30;

      return {
        index,
        name: `Metal ${index + 1}`,
        tempo: 140,
        sceneNames: { A: 'Tight Rhythm', B: 'Chug Boost', C: 'Lead', D: 'Clean Intro' },
        sceneTrims: { A: 12, B: 12, C: 16, D: 12 },
        scenes: { A: sceneA, B: sceneB, C: sceneC, D: sceneD },
        expression: { targetSlot: 5, targetParam: 3, minPct: 10, maxPct: 60, curve: 'vp1' }, // Delay Mix
      };
    },
  },
  {
    id: 'country-twang',
    title: 'Country Twang',
    genreTag: 'Country & Americana',
    summary: 'Dyna Comp squeeze + Centaur push into a Fender Twin, slapback Analog Delay & 63 Spring.',
    createRig: (index: number): GigRig => {
      const sceneA: PedalChain5 = [
        slot(true, 0x01000008, [8, 6, 110, 0]),                        // Dyna Comp
        slot(false, 0x03000150, [40, 56, 50]),                         // Centaur Gold (OFF on clean A)
        slot(true, 0x04000008, [28, 30, 95, 62, 40, 40, 58, 1, 0]),    // FD Combo (bright Twin, CAB ON)
        slot(true, 0x08000030, [120, 14, 28, 8, 0, 100, 0]),           // Analog Delay as slapback
        slot(true, 0x090000c0, [40, 40, 62, 100]),                     // 63 Spring
      ];
      const sceneB = cloneChain(sceneA);
      sceneB[1].enabled = true; // Centaur ON: rhythm push
      sceneB[1].params[0] = 48;

      const sceneC = cloneChain(sceneB);
      sceneC[1].params[0] = 62; // Lead
      sceneC[2].params[0] = 36;
      sceneC[3].params[1] = 24;
      sceneC[3].params[2] = 34;

      const sceneD = cloneChain(sceneA);
      sceneD[0].params[0] = 5; // Ballad: softer comp, longer echo, more spring
      sceneD[3].params[0] = 380;
      sceneD[3].params[1] = 30;
      sceneD[3].params[2] = 30;
      sceneD[4].params[1] = 56;

      return {
        index,
        name: `Country ${index + 1}`,
        tempo: 110,
        sceneNames: { A: 'Clean Chicken', B: 'Push Rhythm', C: 'Twang Lead', D: 'Slow Ballad' },
        sceneTrims: { A: 12, B: 12, C: 15, D: 12 },
        scenes: { A: sceneA, B: sceneB, C: sceneC, D: sceneD },
        expression: { targetSlot: 6, targetParam: 2, minPct: 20, maxPct: 80, curve: 'vp1' }, // Spring mixer
      };
    },
  },
  {
    id: 'indie-shimmer-wash',
    title: 'Indie & Post-Rock',
    genreTag: 'Indie, Alt & Post-Rock',
    summary: 'Stereo Chorus + NYC Muff fuzz into a Deluxe-R, Tape Echo trails & Shimmer Reverb swells.',
    createRig: (index: number): GigRig => {
      const sceneA: PedalChain5 = [
        slot(true, 0x060000a0, [40, 18, 45, 7, 100]),                  // Stereo Chorus
        slot(false, 0x03000160, [52, 55, 62]),                         // NYC Muff fuzz (OFF on A)
        slot(true, 0x04000010, [40, 30, 100, 52, 46, 46, 52, 1, 0]),   // Deluxe-R (CAB ON)
        slot(true, 0x08000010, [480, 48, 34, 5, 100, 0]),              // Tape Echo
        slot(true, 0x09000180, [39, 72, 30, 50, 74, 0]),               // Shimmer Reverb
      ];
      const sceneB = cloneChain(sceneA);
      sceneB[1].enabled = true; // Fuzz ON
      sceneB[0].enabled = false;

      const sceneC = cloneChain(sceneB);
      sceneC[1].params[2] = 78; // Fuzz sustain: big lead
      sceneC[3].params[2] = 44;
      sceneC[4].params[2] = 36;

      const sceneD = cloneChain(sceneA);
      sceneD[3].params[1] = 62; // Ambient swell
      sceneD[3].params[2] = 46;
      sceneD[4].params[1] = 90;
      sceneD[4].params[2] = 62;

      return {
        index,
        name: `Indie ${index + 1}`,
        tempo: 100,
        sceneNames: { A: 'Chorus Clean', B: 'Fuzz Verse', C: 'Big Lead', D: 'Shimmer Swell' },
        sceneTrims: { A: 12, B: 12, C: 15, D: 13 },
        scenes: { A: sceneA, B: sceneB, C: sceneC, D: sceneD },
        expression: { targetSlot: 6, targetParam: 3, minPct: 15, maxPct: 75, curve: 'swell' }, // Shimmer mix
      };
    },
  },
  {
    id: 'jazz-neo-soul-clean',
    title: 'Jazz & Neo-Soul',
    genreTag: 'Jazz, Neo-Soul & Smooth Clean',
    summary: 'Gentle Comp + CE-1 Chorus into a warm Twin, light Digital Delay & HD Hall.',
    createRig: (index: number): GigRig => {
      const sceneA: PedalChain5 = [
        slot(true, 0x01000008, [4, 5, 100, 0]),                        // Dyna Comp (light)
        slot(false, 0x06000090, [2, 20, 34, 100]),                     // Vintage CE-1 Chorus (OFF on A)
        slot(true, 0x04000008, [18, 30, 92, 36, 52, 56, 38, 1, 0]),    // FD Combo, dark & warm (CAB ON)
        slot(true, 0x08000008, [320, 16, 14, 6, 0, 100, 0]),           // Digital Delay (subtle)
        slot(true, 0x09000008, [40, 30, 22, 40, 55, 0]),               // HD Hall (small)
      ];
      const sceneB = cloneChain(sceneA);
      sceneB[1].enabled = true; // Chorus shimmer for chords

      const sceneC = cloneChain(sceneA);
      sceneC[2].params[0] = 30; // Soloing: a touch more gain and level, echo up
      sceneC[2].params[2] = 100;
      sceneC[3].params[2] = 24;
      sceneC[4].params[2] = 26;

      const sceneD = cloneChain(sceneB);
      sceneD[3].params[1] = 28; // Ballad: bigger room
      sceneD[3].params[2] = 22;
      sceneD[4].params[1] = 48;
      sceneD[4].params[2] = 34;

      return {
        index,
        name: `Jazz ${index + 1}`,
        tempo: 90,
        sceneNames: { A: 'Warm Comping', B: 'Chorus Chords', C: 'Solo', D: 'Ballad' },
        sceneTrims: { A: 12, B: 12, C: 14, D: 12 },
        scenes: { A: sceneA, B: sceneB, C: sceneC, D: sceneD },
        expression: { targetSlot: 6, targetParam: 3, minPct: 15, maxPct: 55, curve: 'linear' }, // Hall mix
      };
    },
  },
];

/** The four original templates: used to fill a brand-new set of 12 rigs. Newer genre templates are load-on-demand only. */
const DEFAULT_RIG_TEMPLATES = STARTER_TEMPLATES.slice(0, 4);

export function createDefault12Rigs(): GigRig[] {
  return Array.from({ length: 12 }, (_, idx) =>
    DEFAULT_RIG_TEMPLATES[idx % DEFAULT_RIG_TEMPLATES.length].createRig(idx)
  );
}
