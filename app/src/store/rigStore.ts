import { create } from 'zustand';
import { getEffectDefinition } from '../data/effectCatalog';
import { createDefault12Rigs, STARTER_TEMPLATES } from '../data/starterTemplates';
import { webMidiService } from '../midi/webMidiService';
import {
  ExpressionConfig,
  GigRig,
  PedalSlotState,
  SCENE_IDS,
  SceneId,
} from '../types/rig';

const STORAGE_KEY = 'ms50g-scene-studio-v1';

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function isValidSlot(slot: unknown): slot is PedalSlotState {
  if (!isRecord(slot)) return false;
  return (
    typeof slot.enabled === 'boolean' &&
    typeof slot.fxid === 'number' &&
    Number.isFinite(slot.fxid) &&
    Array.isArray(slot.params) &&
    slot.params.length === 9 &&
    slot.params.every((p) => typeof p === 'number' && Number.isFinite(p))
  );
}

export function isValidGigRigArray(data: unknown): data is GigRig[] {
  if (!Array.isArray(data) || data.length !== 12) return false;
  return data.every((rig) => {
    if (!isRecord(rig)) return false;
    if (typeof rig.name !== 'string') return false;
    if (typeof rig.tempo !== 'number' || !Number.isFinite(rig.tempo)) return false;
    if (!isRecord(rig.sceneNames) || !isRecord(rig.sceneTrims) || !isRecord(rig.scenes)) {
      return false;
    }
    for (const sc of SCENE_IDS) {
      if (typeof rig.sceneNames[sc] !== 'string') return false;
      if (typeof rig.sceneTrims[sc] !== 'number' || !Number.isFinite(rig.sceneTrims[sc])) {
        return false;
      }
      const chain = rig.scenes[sc];
      if (!Array.isArray(chain) || chain.length !== 5 || !chain.every(isValidSlot)) {
        return false;
      }
    }
    const exp = rig.expression;
    if (!isRecord(exp)) return false;
    if (
      typeof exp.targetSlot !== 'number' ||
      typeof exp.targetParam !== 'number' ||
      typeof exp.minPct !== 'number' ||
      typeof exp.maxPct !== 'number' ||
      typeof exp.curve !== 'string'
    ) {
      return false;
    }
    return true;
  });
}

function getSafeStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  const desc = Object.getOwnPropertyDescriptor(window, 'localStorage');
  if (!desc || typeof desc.value?.getItem !== 'function') return null;
  return desc.value as Storage;
}

function loadSavedRigs(): GigRig[] {
  try {
    const storage = getSafeStorage();
    if (!storage) return createDefault12Rigs();
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return createDefault12Rigs();
    const parsed = JSON.parse(raw);
    if (isValidGigRigArray(parsed)) {
      return parsed;
    }
  } catch {
    // Fall back to clean defaults
  }
  return createDefault12Rigs();
}

function persistRigs(rigs: GigRig[]): void {
  try {
    const storage = getSafeStorage();
    if (storage) {
      storage.setItem(STORAGE_KEY, JSON.stringify(rigs));
    }
  } catch {
    // Ignore storage quota errors in headless environments
  }
}

function cloneRigs(rigs: GigRig[]): GigRig[] {
  return JSON.parse(JSON.stringify(rigs)) as GigRig[];
}

export interface RigStoreState {
  rigs: GigRig[];
  activeRigIndex: number;
  activeScene: SceneId;
  liveFootCc: number;
  selectRig: (rigIndex: number) => void;
  renameRig: (rigIndex: number, name: string) => void;
  setScene: (scene: SceneId) => void;
  renameScene: (scene: SceneId, label: string) => void;
  setSceneTrim: (scene: SceneId, trimIdx: number) => void;
  copySceneAToCurrent: () => void;
  togglePedal: (pedalIdx0to4: number) => void;
  setPedalParam: (pedalIdx0to4: number, paramIdx0to8: number, value: number) => void;
  setPedalModel: (pedalIdx0to4: number, newFxid: number) => void;
  setExpression: (patch: Partial<ExpressionConfig>) => void;
  loadTemplateIntoActiveRig: (templateId: string) => void;
  loadRigsFromPedal: (rigs: GigRig[]) => void;
  setLiveFootCc: (ccVal: number) => void;
  exportRigPackJson: () => string;
  importRigPackJson: (jsonText: string) => { ok: boolean; error?: string };
  resetToDefaults: () => void;
  setRawSlotForTest: (pedalIdx0to4: number, rawSlot: PedalSlotState) => void;
}

export const useRigStore = create<RigStoreState>((set, get) => ({
  rigs: loadSavedRigs(),
  activeRigIndex: 0,
  activeScene: 'A',
  liveFootCc: 0,

  selectRig: (rigIndex: number) => {
    const clamped = Math.max(0, Math.min(11, rigIndex));
    set({ activeRigIndex: clamped, activeScene: 'A' });
    webMidiService.sendRigSelectPreview(clamped);
  },

  renameRig: (rigIndex: number, name: string) => {
    const next = cloneRigs(get().rigs);
    next[rigIndex].name = name.slice(0, 22);
    persistRigs(next);
    set({ rigs: next });
  },

  setScene: (scene: SceneId) => {
    set({ activeScene: scene });
    webMidiService.sendScenePreview(scene);
  },

  renameScene: (scene: SceneId, label: string) => {
    const { rigs, activeRigIndex } = get();
    const next = cloneRigs(rigs);
    next[activeRigIndex].sceneNames[scene] = label.slice(0, 18);
    persistRigs(next);
    set({ rigs: next });
  },

  setSceneTrim: (scene: SceneId, trimIdx: number) => {
    const { rigs, activeRigIndex } = get();
    const next = cloneRigs(rigs);
    const clampedTrim = Math.max(0, Math.min(24, Math.round(trimIdx)));
    next[activeRigIndex].sceneTrims[scene] = clampedTrim;
    persistRigs(next);
    set({ rigs: next });
    webMidiService.sendTrimPreview(clampedTrim);
  },

  copySceneAToCurrent: () => {
    const { rigs, activeRigIndex, activeScene } = get();
    if (activeScene === 'A') return;
    const next = cloneRigs(rigs);
    const rig = next[activeRigIndex];
    rig.scenes[activeScene] = JSON.parse(JSON.stringify(rig.scenes.A));
    rig.sceneTrims[activeScene] = rig.sceneTrims.A;
    persistRigs(next);
    set({ rigs: next });
  },

  togglePedal: (pedalIdx0to4: number) => {
    const { rigs, activeRigIndex, activeScene } = get();
    const next = cloneRigs(rigs);
    const slot = next[activeRigIndex].scenes[activeScene][pedalIdx0to4];
    slot.enabled = !slot.enabled;
    persistRigs(next);
    set({ rigs: next });
    webMidiService.sendPedalBypassPreview(pedalIdx0to4, slot.enabled);
  },

  setPedalParam: (pedalIdx0to4: number, paramIdx0to8: number, value: number) => {
    const { rigs, activeRigIndex, activeScene } = get();
    const next = cloneRigs(rigs);
    const slot = next[activeRigIndex].scenes[activeScene][pedalIdx0to4];
    slot.params[paramIdx0to8] = Math.round(value);
    persistRigs(next);
    set({ rigs: next });
    webMidiService.sendKnobPreview(pedalIdx0to4, slot.fxid, paramIdx0to8, slot.params[paramIdx0to8]);
  },

  setPedalModel: (pedalIdx0to4: number, newFxid: number) => {
    const { rigs, activeRigIndex } = get();
    const def = getEffectDefinition(newFxid);
    const defaultParams = Array.from({ length: 9 }, (_, i) => def?.params[i]?.defaultValue ?? 0);
    const next = cloneRigs(rigs);
    const rig = next[activeRigIndex];
    for (const sc of SCENE_IDS) {
      const wasEnabled = rig.scenes[sc][pedalIdx0to4].enabled;
      rig.scenes[sc][pedalIdx0to4] = {
        enabled: wasEnabled,
        fxid: newFxid,
        params: [...defaultParams],
      };
    }
    const maxParams = def?.params.length ?? 3;
    if (rig.expression.targetSlot === pedalIdx0to4 + 2 && rig.expression.targetParam > maxParams) {
      rig.expression.targetParam = 1;
    }
    persistRigs(next);
    set({ rigs: next });
  },

  setExpression: (patch: Partial<ExpressionConfig>) => {
    const { rigs, activeRigIndex } = get();
    const next = cloneRigs(rigs);
    next[activeRigIndex].expression = {
      ...next[activeRigIndex].expression,
      ...patch,
    };
    persistRigs(next);
    set({ rigs: next });
  },

  loadTemplateIntoActiveRig: (templateId: string) => {
    const tpl = STARTER_TEMPLATES.find((t) => t.id === templateId);
    if (!tpl) return;
    const { rigs, activeRigIndex } = get();
    const next = cloneRigs(rigs);
    next[activeRigIndex] = tpl.createRig(activeRigIndex);
    persistRigs(next);
    set({ rigs: next, activeScene: 'A' });
  },

  loadRigsFromPedal: (rigs: GigRig[]) => {
    if (!isValidGigRigArray(rigs)) return;
    const cloned = cloneRigs(rigs);
    persistRigs(cloned);
    set({ rigs: cloned, activeRigIndex: 0, activeScene: 'A' });
  },

  setLiveFootCc: (ccVal: number) => {
    set({ liveFootCc: Math.max(0, Math.min(127, ccVal)) });
  },

  exportRigPackJson: (): string => {
    return JSON.stringify(
      {
        format: 'ms50g-scene-studio-rigpack',
        version: 1,
        rigs: get().rigs,
      },
      null,
      2
    );
  },

  importRigPackJson: (jsonText: string) => {
    try {
      const parsed = JSON.parse(jsonText);
      const list = Array.isArray(parsed) ? parsed : parsed?.rigs;
      if (!isValidGigRigArray(list)) {
        return {
          ok: false,
          error:
            'Rig Pack file is invalid or incomplete. Expected 12 complete Gig Rigs with Scenes A–D.',
        };
      }
      persistRigs(list);
      set({ rigs: cloneRigs(list), activeRigIndex: 0, activeScene: 'A' });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: `Invalid JSON file: ${(err as Error).message}` };
    }
  },

  resetToDefaults: () => {
    const fresh = createDefault12Rigs();
    persistRigs(fresh);
    set({ rigs: fresh, activeRigIndex: 0, activeScene: 'A', liveFootCc: 0 });
  },

  setRawSlotForTest: (pedalIdx0to4: number, rawSlot: PedalSlotState) => {
    const { rigs, activeRigIndex, activeScene } = get();
    const next = cloneRigs(rigs);
    next[activeRigIndex].scenes[activeScene][pedalIdx0to4] = rawSlot;
    set({ rigs: next });
  },
}));
