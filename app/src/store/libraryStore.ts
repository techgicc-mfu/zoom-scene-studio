import { create } from 'zustand';
import { editRawSlot, RawSlotEdit, setRawPatchName } from '../midi/zoomProtocol';
import { ZdlInfo } from '../midi/zdlParser';
import { INSTALLED_EFFECTS } from '../data/installedEffects';
import { registerInstalledEffects, setDeviceEffectIds } from '../data/effectCatalog';

/** Effects known from the pedal's own .ZDL files (shipped with the app; replaced if the user re-reads the pedal). */
const SEEDED: Record<number, ZdlInfo> = Object.fromEntries(
  INSTALLED_EFFECTS.map((e) => [
    e.fxid,
    {
      fxid: e.fxid,
      name: e.name,
      size: 0,
      params: e.params.map((p) => ({ name: p.name, min: 0, max: p.max, defaultValue: p.def, raw: [] })),
    } as ZdlInfo,
  ])
);

/** Device Library: the raw 122-byte presets last read from the MS-50G, plus the user's pending edits. */
interface LibraryState {
  /** As read from the device (null until a read). */
  original: Uint8Array[] | null;
  /** Working copies, edited in place without touching bits the app does not model. */
  working: Uint8Array[] | null;
  /** Effects installed on the pedal, parsed from its .ZDL files, keyed by effect id. */
  installed: Record<number, ZdlInfo>;
  setInstalled: (list: ZdlInfo[]) => void;
  setFromDevice: (raw: Uint8Array[]) => void;
  editSlot: (patch: number, slot: number, edit: RawSlotEdit) => void;
  editName: (patch: number, name: string) => void;
  markWritten: (patch: number) => void;
  revert: (patch: number) => void;
  isDirty: (patch: number) => boolean;
}

const same = (a?: Uint8Array, b?: Uint8Array) =>
  !!a && !!b && a.length === b.length && a.every((v, i) => v === b[i]);

export const useLibraryStore = create<LibraryState>((set, get) => ({
  original: null,
  working: null,
  installed: SEEDED,
  setInstalled: (list) => {
    registerInstalledEffects(list.map((z) => ({ fxid: z.fxid, name: z.name, params: z.params.map((p) => ({ name: p.name, max: p.max, defaultValue: p.defaultValue })) })));
    setDeviceEffectIds(list.map((z) => z.fxid));
    set({ installed: Object.fromEntries(list.map((z) => [z.fxid, z])) });
  },
  setFromDevice: (raw) =>
    set({ original: raw.map((r) => new Uint8Array(r)), working: raw.map((r) => new Uint8Array(r)) }),
  editSlot: (patch, slot, edit) =>
    set((st) => {
      if (!st.working?.[patch]) return st;
      const working = st.working.slice();
      working[patch] = editRawSlot(working[patch], slot, edit);
      return { working };
    }),
  editName: (patch, name) =>
    set((st) => {
      if (!st.working?.[patch]) return st;
      const working = st.working.slice();
      working[patch] = setRawPatchName(working[patch], name);
      return { working };
    }),
  markWritten: (patch) =>
    set((st) => {
      if (!st.working || !st.original) return st;
      const original = st.original.slice();
      original[patch] = new Uint8Array(st.working[patch]);
      return { original };
    }),
  revert: (patch) =>
    set((st) => {
      if (!st.working || !st.original) return st;
      const working = st.working.slice();
      working[patch] = new Uint8Array(st.original[patch]);
      return { working };
    }),
  isDirty: (patch) => {
    const { original, working } = get();
    return !same(original?.[patch], working?.[patch]);
  },
}));
