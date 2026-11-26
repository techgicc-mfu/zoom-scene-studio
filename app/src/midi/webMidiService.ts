import { getEffectDefinition } from '../data/effectCatalog';
import { GigRig, SceneId, SyncProgress } from '../types/rig';
import {
  buildChocolateDiscoverySysex,
  buildChocolateLiveConfigPackets,
  decodeChocolateWriteAddr,
  describeChocolateAddr,
  SCENE_CC_VALUES,
} from './chocolateProtocol';
import {
  buildPatchRequestSysex,
  buildPatchStoreSysex,
  buildPatchWriteSysex,
  compileRigsTo48Patches,
  decompile48PatchesToRigs,
  decodePatchReadSysex,
  MIDI_PATCH_BYTES,
  unpackRawPatch128,
} from './zoomProtocol';

export interface MidiPortLike {
  id?: string;
  name?: string | null;
  state?: string;
  connection?: string;
  open?: () => Promise<unknown>;
  send: (data: number[] | Uint8Array) => void;
}

export interface MidiInputLike {
  id?: string;
  name?: string | null;
  state?: string;
  connection?: string;
  open?: () => Promise<unknown>;
  onmidimessage: ((ev: { data: Uint8Array }) => void) | null;
}

export interface InjectedPorts {
  zoomOut?: MidiPortLike | null;
  zoomIn?: MidiInputLike | null;
  chocolateOut?: MidiPortLike | null;
  chocolateIn?: MidiInputLike | null;
  zoomModelId?: 0x58 | 0x61;
}

export interface ConnectResult {
  ok: boolean;
  zoomConnected: boolean;
  chocolateConnected: boolean;
  zoomName: string | null;
  chocolateName: string | null;
  userMessage: string;
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isUnambiguousChocolateName(label: string): boolean {
  return (
    label.includes('sinco') ||
    label.includes('footctrl') ||
    label.includes('chocolate') ||
    label.includes('m-vave')
  );
}

function isZoomName(label: string): boolean {
  return (
    label.includes('zoom') ||
    label.includes('ms-50') ||
    label.includes('ms-70') ||
    label.includes('ms series')
  );
}

export class WebMidiService {
  private zoomOut: MidiPortLike | null = null;
  private zoomIn: MidiInputLike | null = null;
  private chocolateOut: MidiPortLike | null = null;
  private chocolateIn: MidiInputLike | null = null;
  private zoomModelId: 0x58 | 0x61 = 0x61;
  private injected: InjectedPorts | null | undefined;
  private expressionListeners: Set<(ccVal: number) => void> = new Set();
  private connectionListeners: Set<(status: ReturnType<WebMidiService['getStatus']>) => void> = new Set();
  private pendingZoomDumpResolve: ((data: Uint8Array) => void) | null = null;
  private pendingZoomAckResolve: (() => void) | null = null;
  private pendingZoomIdentityResolve: (() => void) | null = null;
  /** Incremented on every Chocolate Plus `F0 00 32 01` config ACK. */
  private chocoAckCount: number = 0;
  private chocoAckWaiters: Set<() => void> = new Set();
  private chocolateMidiListeners: Set<(data: Uint8Array) => void> = new Set();
  private zoomRxCount: number = 0;
  private lastZoomRxSummary: string = 'none';

  constructor(injected?: InjectedPorts | null) {
    this.injected = injected;
    if (injected && typeof injected === 'object') {
      this.zoomOut = injected.zoomOut ?? null;
      this.zoomIn = injected.zoomIn ?? null;
      this.chocolateOut = injected.chocolateOut ?? null;
      this.chocolateIn = injected.chocolateIn ?? null;
      if (this.zoomIn) {
        this.zoomIn.onmidimessage = (ev) => this.handleZoomReply(ev.data);
      }
      if (this.chocolateIn) {
        this.chocolateIn.onmidimessage = (ev) => this.handleChocolateInput(ev.data);
      }
      if (injected.zoomModelId) this.zoomModelId = injected.zoomModelId;
    }
  }

  public getStatus() {
    return {
      zoomConnected: Boolean(this.zoomOut),
      chocolateConnected: Boolean(this.chocolateOut),
      zoomName: this.zoomOut?.name ?? null,
      chocolateName: this.chocolateOut?.name ?? null,
    };
  }

  public onExpressionSweep(cb: (ccVal: number) => void): () => void {
    this.expressionListeners.add(cb);
    return () => {
      this.expressionListeners.delete(cb);
    };
  }

  /** Raw channel messages (CC / PC / Note) from the Chocolate Plus USB port, for the Footswitch Tester. */
  public onChocolateMidi(cb: (data: Uint8Array) => void): () => void {
    this.chocolateMidiListeners.add(cb);
    return () => {
      this.chocolateMidiListeners.delete(cb);
    };
  }

  public onConnectionChange(
    cb: (status: ReturnType<WebMidiService['getStatus']>) => void
  ): () => void {
    this.connectionListeners.add(cb);
    return () => {
      this.connectionListeners.delete(cb);
    };
  }

  private notifyConnectionChange(): void {
    const status = this.getStatus();
    for (const cb of this.connectionListeners) cb(status);
  }

  public async connect(): Promise<ConnectResult> {
    if (this.injected === null) {
      return {
        ok: false,
        zoomConnected: false,
        chocolateConnected: false,
        zoomName: null,
        chocolateName: null,
        userMessage:
          'WebMIDI is not available in this browser. Please open Scene Studio in Google Chrome or Microsoft Edge.',
      };
    }

    if (this.injected) {
      return {
        ok: true,
        ...this.getStatus(),
        userMessage: 'Connected to injected MIDI ports.',
      };
    }

    const nav = typeof navigator !== 'undefined' ? (navigator as any) : undefined;
    if (!nav || typeof nav.requestMIDIAccess !== 'function') {
      return {
        ok: false,
        zoomConnected: false,
        chocolateConnected: false,
        zoomName: null,
        chocolateName: null,
        userMessage:
          'WebMIDI is not supported in this browser. Please use Google Chrome or Microsoft Edge on Windows.',
      };
    }

    try {
      const access = await nav.requestMIDIAccess({ sysex: true });
      if (this.zoomIn) this.zoomIn.onmidimessage = null;
      if (this.chocolateIn) this.chocolateIn.onmidimessage = null;
      this.zoomOut = null;
      this.zoomIn = null;
      this.chocolateOut = null;
      this.chocolateIn = null;

      const genericOutputs: MidiPortLike[] = [];
      const genericInputs: MidiInputLike[] = [];

      for (const output of access.outputs.values()) {
        const label = String(output.name || '').toLowerCase();
        if (isZoomName(label)) {
          this.zoomOut = output;
        } else if (isUnambiguousChocolateName(label)) {
          this.chocolateOut = output;
        } else if (label.includes('usb midi')) {
          genericOutputs.push(output);
        }
      }

      for (const input of access.inputs.values()) {
        const label = String(input.name || '').toLowerCase();
        if (isZoomName(label)) {
          this.zoomIn = input;
          input.onmidimessage = (ev: { data: Uint8Array }) => this.handleZoomReply(ev.data);
        } else if (isUnambiguousChocolateName(label)) {
          this.chocolateIn = input;
          input.onmidimessage = (ev: { data: Uint8Array }) => this.handleChocolateInput(ev.data);
        } else if (label.includes('usb midi')) {
          genericInputs.push(input);
        }
      }

      // Only bind generic "usb midi" ports as Chocolate Plus after receiving an authentic F0 00 32 45 58 reply
      if (!this.chocolateOut && genericOutputs.length > 0 && genericInputs.length > 0) {
        const probe = buildChocolateDiscoverySysex();
        for (const outCandidate of genericOutputs) {
          let verifiedInput: MidiInputLike | null = null as MidiInputLike | null;
          await new Promise<void>((resolve) => {
            const tempHandlers: Array<() => void> = [];
            const timer = setTimeout(() => {
              for (const clean of tempHandlers) clean();
              resolve();
            }, 150);

            for (const inCandidate of genericInputs) {
              inCandidate.onmidimessage = (ev: { data: Uint8Array }) => {
                const d = ev.data;
                if (
                  d.length >= 5 &&
                  d[0] === 0xf0 &&
                  d[1] === 0x00 &&
                  d[2] === 0x32 &&
                  d[3] === 0x45 &&
                  d[4] === 0x58
                ) {
                  verifiedInput = inCandidate;
                  clearTimeout(timer);
                  for (const clean of tempHandlers) clean();
                  resolve();
                }
              };
              tempHandlers.push(() => {
                if (inCandidate !== verifiedInput) inCandidate.onmidimessage = null;
              });
            }

            try {
              outCandidate.send(probe);
            } catch {
              clearTimeout(timer);
              for (const clean of tempHandlers) clean();
              resolve();
            }
          });

          const matchedIn = verifiedInput;
          if (matchedIn) {
            this.chocolateOut = outCandidate;
            this.chocolateIn = matchedIn;
            matchedIn.onmidimessage = (ev: { data: Uint8Array }) =>
              this.handleChocolateInput(ev.data);
            break;
          }
        }
      }

      access.onstatechange = (ev: any) => {
        const port = ev?.port;
        if (!port || port.state !== 'disconnected') return;
        let changed = false;
        if (this.zoomOut && (port === this.zoomOut || port.id === this.zoomOut.id)) {
          this.zoomOut = null;
          changed = true;
        }
        if (this.zoomIn && (port === this.zoomIn || port.id === this.zoomIn.id)) {
          this.zoomIn.onmidimessage = null;
          this.zoomIn = null;
          changed = true;
        }
        if (
          this.chocolateOut &&
          (port === this.chocolateOut || port.id === this.chocolateOut.id)
        ) {
          this.chocolateOut = null;
          changed = true;
        }
        if (this.chocolateIn && (port === this.chocolateIn || port.id === this.chocolateIn.id)) {
          this.chocolateIn.onmidimessage = null;
          this.chocolateIn = null;
          changed = true;
        }
        if (changed) this.notifyConnectionChange();
      };

      if (this.zoomIn) {
        try {
          await this.zoomIn.open?.();
        } catch {
          // ignore open error if already open
        }
      }
      if (this.zoomOut) {
        try {
          await this.zoomOut.open?.();
        } catch {
          // ignore open error if already open
        }
        this.zoomRxCount = 0;
        this.lastZoomRxSummary = 'none';
        const idPromise = this.zoomIn
          ? new Promise<void>((resolve) => {
              const t = setTimeout(() => {
                if (this.pendingZoomIdentityResolve) {
                  this.pendingZoomIdentityResolve = null;
                  resolve();
                }
              }, 350);
              this.pendingZoomIdentityResolve = () => {
                clearTimeout(t);
                resolve();
              };
            })
          : Promise.resolve();
        this.zoomOut.send(new Uint8Array([0xf0, 0x7e, 0x00, 0x06, 0x01, 0xf7]));
        await idPromise;
      }
      if (this.chocolateIn) {
        try {
          await this.chocolateIn.open?.();
        } catch {
          // ignore open error if already open
        }
      }
      if (this.chocolateOut) {
        try {
          await this.chocolateOut.open?.();
        } catch {
          // ignore open error if already open
        }
        this.chocolateOut.send(buildChocolateDiscoverySysex());
      }

      const status = this.getStatus();
      this.notifyConnectionChange();
      const parts: string[] = [];
      if (status.zoomConnected) parts.push('Zoom MS-50G connected');
      if (status.chocolateConnected) parts.push('Chocolate Plus connected');

      return {
        ok: true,
        ...status,
        userMessage:
          parts.length > 0
            ? parts.join(' · ')
            : 'No pedals detected over USB yet. Plug in your MS-50G and Chocolate Plus (switch set to U) and click Scan USB.',
      };
    } catch (err) {
      return {
        ok: false,
        zoomConnected: false,
        chocolateConnected: false,
        zoomName: null,
        chocolateName: null,
        userMessage: `Could not access USB MIDI permissions: ${(err as Error).message}`,
      };
    }
  }

  private handleZoomReply(data: Uint8Array): void {
    this.zoomRxCount++;
    const head = Array.from(data.slice(0, 10))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join(' ');
    this.lastZoomRxSummary = `len=${data.length} [${head}]`;

    // Universal Identity Reply: F0 7E 00 06 02 52 <modelId> ...
    if (data.length >= 7 && data[0] === 0xf0 && data[1] === 0x7e && data[5] === 0x52) {
      if (data[6] === 0x58 || data[6] === 0x61) {
        this.zoomModelId = data[6];
      }
      if (this.pendingZoomIdentityResolve) {
        const resolve = this.pendingZoomIdentityResolve;
        this.pendingZoomIdentityResolve = null;
        resolve();
      }
      return;
    }
    // Zoom SysEx Store / Command ACK: F0 52 00 <modelId> 00 ... F7
    if (
      data.length >= 6 &&
      data[0] === 0xf0 &&
      data[1] === 0x52 &&
      (data[3] === 0x58 || data[3] === 0x61) &&
      data[4] === 0x00 &&
      this.pendingZoomAckResolve
    ) {
      const resolve = this.pendingZoomAckResolve;
      this.pendingZoomAckResolve = null;
      resolve();
      return;
    }
    // 146-byte Patch Dump response: F0 52 00 <modelId> 28 ... F7
    if (
      data.length === MIDI_PATCH_BYTES &&
      data[0] === 0xf0 &&
      data[1] === 0x52 &&
      data[4] === 0x28 &&
      this.pendingZoomDumpResolve
    ) {
      const resolve = this.pendingZoomDumpResolve;
      this.pendingZoomDumpResolve = null;
      resolve(new Uint8Array(data));
    }
  }

  private handleChocolateInput(data: Uint8Array): void {
    // M-Vave Chocolate Plus Config ACK: F0 00 32 01 ... F7
    if (
      data.length >= 4 &&
      data[0] === 0xf0 &&
      data[1] === 0x00 &&
      data[2] === 0x32 &&
      data[3] === 0x01
    ) {
      this.chocoAckCount++;
      for (const wake of Array.from(this.chocoAckWaiters)) wake();
      return;
    }
    if (data.length >= 2 && data[0] >= 0x80 && data[0] < 0xf0) {
      for (const listener of this.chocolateMidiListeners) listener(new Uint8Array(data));
    }
    // Control Change message 0xB0..0xBF: filter strictly to Expression CCs (CC 16 configured, CC 11 factory)
    if (data.length >= 3 && (data[0] & 0xf0) === 0xb0) {
      const ccNum = data[1] & 0x7f;
      if (ccNum !== 16 && ccNum !== 11) {
        return;
      }
      const ccValue = data[2] & 0x7f;
      for (const listener of this.expressionListeners) {
        listener(ccValue);
      }
    }
  }

  /** Sends live MIDISTOMP PC/CC preview when changing rigs, scenes, solo trim, or pedal knobs. */
  public sendRigSelectPreview(rigIndex: number): void {
    if (!this.zoomOut) return;
    const pc = Math.max(0, Math.min(11, Math.trunc(rigIndex)));
    try {
      this.zoomOut.send([0xc0, pc]);
    } catch {
      // Ignore transient live-preview drops
    }
  }

  public sendScenePreview(scene: SceneId): void {
    if (!this.zoomOut) return;
    try {
      this.zoomOut.send([0xb0, 15, SCENE_CC_VALUES[scene]]);
    } catch {
      // Ignore transient live-preview drops
    }
  }

  public sendTrimPreview(trimIdx: number): void {
    if (!this.zoomOut) return;
    const clamped = Math.max(0, Math.min(24, Math.round(trimIdx)));
    const ccVal = Math.max(0, Math.min(127, Math.round((clamped / 24) * 127)));
    try {
      this.zoomOut.send([0xb0, 17, ccVal]);
    } catch {
      // Ignore transient live-preview drops
    }
  }

  public sendPedalBypassPreview(pedalIndex0to4: number, enabled: boolean): void {
    if (!this.zoomOut) return;
    const effectSlot1to6 = pedalIndex0to4 + 2; // Slots 2..6
    const cc = effectSlot1to6 * 10 + 4;
    try {
      this.zoomOut.send([0xb0, cc, enabled ? 127 : 0]);
    } catch {
      // Ignore transient preview drops
    }
  }

  public sendKnobPreview(
    pedalIndex0to4: number,
    fxid: number,
    paramIndex0to8: number,
    rawVal: number
  ): void {
    if (!this.zoomOut) return;
    const effectSlot1to6 = pedalIndex0to4 + 2;
    const cc = effectSlot1to6 * 10 + 4 + (paramIndex0to8 + 1);
    const def = getEffectDefinition(fxid);
    const max = def?.params[paramIndex0to8]?.max ?? 100;
    const ccVal = Math.max(0, Math.min(127, Math.round((rawVal / Math.max(1, max)) * 127)));
    try {
      this.zoomOut.send([0xb0, cc, ccVal]);
    } catch {
      // Ignore transient preview drops
    }
  }

  private patchLabel(idx: number): string {
    return idx < 12
      ? `Gig Rig ${String(idx + 1).padStart(2, '0')}`
      : `Rig ${String(Math.floor((idx - 12) / 3) + 1).padStart(2, '0')} Scene ${['B', 'C', 'D'][(idx - 12) % 3]}`;
  }

  /** Reads the 48 managed raw patches (PC + `0x29` dump). Leaves editor mode and returns to Rig 01. */
  private async readRaw48(
    onProgress: (p: SyncProgress) => void,
    delayMs: number,
    timeoutMs: number,
    verb: string,
    opts: { settleMs?: number; indices?: number[]; leaveEditorForPc?: boolean } = {}
  ): Promise<{ ok: true; raw48: Uint8Array[] } | { ok: false; label: string; error: string }> {
    const zoomOut = this.zoomOut!;
    const raw48: Uint8Array[] = [];
    // Time the MS-50G is given to finish loading a patch after a Program Change before we ask for its dump;
    // asking too early returns the previously loaded patch.
    const settleMs = opts.settleMs ?? delayMs;
    const indices = opts.indices ?? Array.from({ length: 48 }, (_, i) => i);
    zoomOut.send(new Uint8Array([0xf0, 0x52, 0x00, this.zoomModelId, 0x50, 0xf7]));
    await sleep(delayMs > 0 ? Math.max(delayMs, 80) : 0);

    for (const [n, idx] of indices.entries()) {
      const rigLabel = this.patchLabel(idx);
      onProgress({
        phase: 'backup',
        current: n + 1,
        total: indices.length,
        message: `${verb} ${rigLabel} from Zoom MS-50G...`,
      });

      try {
        const dumpPromise = new Promise<Uint8Array>((resolve, reject) => {
          const timer = setTimeout(() => {
            if (this.pendingZoomDumpResolve) {
              this.pendingZoomDumpResolve = null;
              reject(
                new Error(
                  `Timed out waiting for MS-50G reply on slot ${idx + 1} [model=0x${this.zoomModelId.toString(16)}, rx=${this.zoomRxCount}, last=${this.lastZoomRxSummary}]`
                )
              );
            }
          }, timeoutMs);
          this.pendingZoomDumpResolve = (bytes) => {
            clearTimeout(timer);
            resolve(bytes);
          };
        });

        if (opts.leaveEditorForPc) {
          // Some firmware ignores Program Change while the editor is attached: step out, switch, step back in.
          zoomOut.send(new Uint8Array([0xf0, 0x52, 0x00, this.zoomModelId, 0x51, 0xf7]));
          await sleep(60);
        }
        zoomOut.send([0xc0, idx]);
        await sleep(settleMs);
        if (opts.leaveEditorForPc) {
          zoomOut.send(new Uint8Array([0xf0, 0x52, 0x00, this.zoomModelId, 0x50, 0xf7]));
          await sleep(80);
        }
        zoomOut.send(buildPatchRequestSysex(this.zoomModelId));

        const sysex146 = await dumpPromise;
        raw48[idx] = decodePatchReadSysex(sysex146);
      } catch (err) {
        try {
          zoomOut.send(new Uint8Array([0xf0, 0x52, 0x00, this.zoomModelId, 0x51, 0xf7]));
        } catch {
          // ignore
        }
        return { ok: false, label: rigLabel, error: (err as Error).message };
      }
    }

    try {
      zoomOut.send(new Uint8Array([0xf0, 0x52, 0x00, this.zoomModelId, 0x51, 0xf7]));
      await sleep(delayMs);
      zoomOut.send([0xc0, 0]);
    } catch {
      // Ignore post-read exit-editor / PC return failure
    }
    return { ok: true, raw48 };
  }

  /**
   * Reads all 48 managed patches (Rigs 01..12 + Shadow B/C/D) from a connected Zoom MS-50G
   * using Program Change + `0x29` patch dump requests, preserving custom `.ZDL` fxids.
   */
  public async readAllFromHardware(
    onProgress: (p: SyncProgress) => void,
    delayMs: number = 25,
    timeoutMs: number = 600
  ): Promise<{ ok: boolean; rigs?: GigRig[]; userMessage: string }> {
    if (!this.zoomOut || !this.zoomIn) {
      return {
        ok: false,
        userMessage: 'Connect your Zoom MS-50G over USB and click Scan USB before reading rigs.',
      };
    }

    const res = await this.readRaw48(onProgress, delayMs, timeoutMs, 'Reading');
    if (!res.ok) {
      onProgress({
        phase: 'error',
        current: 0,
        total: 48,
        message: `Failed reading ${res.label} from MS-50G (${res.error}).`,
      });
      return {
        ok: false,
        userMessage: `Could not read ${res.label} from MS-50G (${res.error}).`,
      };
    }

    const rigs = decompile48PatchesToRigs(res.raw48);
    onProgress({
      phase: 'done',
      current: 48,
      total: 48,
      message: 'Loaded all 12 Gig Rigs (48 patches) from your Zoom MS-50G!',
    });
    return {
      ok: true,
      rigs,
      userMessage: 'Loaded all 12 Gig Rigs (including any Custom Pedals) from your Zoom MS-50G!',
    };
  }

  /**
   * Reads all 48 patches back after a sync and compares every pedal's On/Off and model against
   * what Scene Studio intended to write. Returns plain-English mismatches ("Rig 01 Scene B: Pedal 2 ... OFF").
   */
  public async verifyZoomAgainstRigs(
    rigs: GigRig[],
    onProgress: (p: SyncProgress) => void,
    delayMs: number = 25,
    timeoutMs: number = 600
  ): Promise<{ ok: boolean; mismatches: string[]; userMessage: string; inconclusive?: boolean }> {
    if (!this.zoomOut || !this.zoomIn) {
      return { ok: false, mismatches: [], userMessage: 'MS-50G not connected — cannot verify.' };
    }
    // The MS-50G needs a moment to load a patch after a Program Change; a read that is too early returns the previous patch.
    // So: read everything with a generous settle time, then re-read only the patches that differ, much more slowly.
    const settle = delayMs > 0 ? Math.max(delayMs, 150) : 0;
    const res = await this.readRaw48(onProgress, delayMs, Math.max(timeoutMs, settle > 0 ? 1500 : timeoutMs), 'Verifying', {
      settleMs: settle,
    });
    if (!res.ok) {
      return {
        ok: false,
        mismatches: [],
        userMessage: `Could not read back ${res.label} to verify (${res.error}).`,
      };
    }
    let raw48 = res.raw48;
    let detail = compareRigsToRaw48Detailed(rigs, raw48);
    if (detail.messages.length > 0 && settle > 0) {
      const again = await this.readRaw48(onProgress, delayMs, 2500, 'Re-checking', {
        settleMs: 600,
        indices: [...detail.patches].sort((x, y) => x - y),
        leaveEditorForPc: true,
      });
      if (again.ok) {
        raw48 = raw48.map((r, i) => again.raw48[i] ?? r);
        detail = compareRigsToRaw48Detailed(rigs, raw48);
      }
    }
    const mismatches = detail.messages;
    if (mismatches.length === 0) {
      return { ok: true, mismatches, userMessage: 'Verified: all 48 scene patches on the MS-50G match Scene Studio.' };
    }
    // If (nearly) every read returns the very same patch, the MS-50G is not switching patches for us: the read-back
    // says nothing about what was saved, so it must not be reported as a failed write.
    const names = raw48.map((r) => (r ? unpackRawPatch128(r).name : ''));
    const counts = new Map<string, number>();
    for (const n of names) counts.set(n, (counts.get(n) ?? 0) + 1);
    const [topName, topCount] = [...counts.entries()].sort((x, y) => y[1] - x[1])[0] ?? ['', 0];
    if (topCount >= 24) {
      return {
        ok: false,
        inconclusive: true,
        mismatches,
        userMessage: `Read-back inconclusive: the MS-50G answered ${topCount} of 48 patch requests with the same patch ("${topName}") instead of switching patches, so the saved patches could not be checked. The MS-50G did confirm saving each patch.`,
      };
    }
    const held = [...detail.patches]
      .sort((x, y) => x - y)
      .slice(0, 3)
      .map((i) => `${this.patchLabel(i)} holds "${unpackRawPatch128(raw48[i]).name}"`)
      .join('; ');
    return {
      ok: false,
      mismatches,
      userMessage: `MS-50G read-back found ${mismatches.length} difference(s) in ${detail.patches.size} of 48 patches, even after a slower second read: ${mismatches.slice(0, 4).join(' · ')}${mismatches.length > 4 ? ' …' : ''}. [${held}]`,
    };
  }

  private waitForZoomAck(timeoutMs: number): Promise<boolean> {
    if (!this.zoomIn || timeoutMs <= 0) {
      return sleep(timeoutMs).then(() => true);
    }
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (this.pendingZoomAckResolve) {
          this.pendingZoomAckResolve = null;
          resolve(false);
        }
      }, timeoutMs);
      this.pendingZoomAckResolve = () => {
        clearTimeout(timer);
        resolve(true);
      };
    });
  }

  /** Waits until the Chocolate Plus ACK counter moves past `baseline`, or times out. */
  private waitForChocoAckAfter(baseline: number, timeoutMs: number): Promise<boolean> {
    if (this.chocoAckCount > baseline) return Promise.resolve(true);
    return new Promise((resolve) => {
      const wake = () => {
        if (this.chocoAckCount > baseline) {
          clearTimeout(timer);
          this.chocoAckWaiters.delete(wake);
          resolve(true);
        }
      };
      const timer = setTimeout(() => {
        this.chocoAckWaiters.delete(wake);
        resolve(this.chocoAckCount > baseline);
      }, timeoutMs);
      this.chocoAckWaiters.add(wake);
    });
  }

  /**
   * Sends every Chocolate Plus `09 49` write and REQUIRES an ACK for each one, retrying up to 3 times.
   * Previously a missing ACK was silently ignored, so dropped writes (e.g. a whole switch's Short Tap)
   * still reported "Sync complete".
   */
  private async programChocolate(
    packets: Uint8Array[],
    onProgress: (p: SyncProgress) => void,
    delayMs: number,
    stepOffset: number,
    totalSteps: number
  ): Promise<{ ok: boolean; userMessage: string; failed: string[] }> {
    const canVerify = Boolean(this.chocolateIn && delayMs > 0);
    const ackTimeoutMs = 400;
    const maxAttempts = 3;
    const paceMs = delayMs > 1 ? (canVerify ? 10 : 40) : delayMs;
    const failed: string[] = [];
    let step = stepOffset;
    let pktIdx = 0;

    try {
      for (let i = 0; i < packets.length; i++) {
        pktIdx = i;
        const pkt = packets[i];
        const label = describeChocolateAddr(decodeChocolateWriteAddr(pkt));
        onProgress({
          phase: 'chocolate',
          current: step + 1,
          total: totalSteps,
          message: `Configuring Chocolate Plus: ${label}...`,
        });

        if (!canVerify) {
          this.chocolateOut!.send(pkt);
          if (paceMs > 0) await sleep(paceMs);
        } else {
          let acked = false;
          for (let attempt = 0; attempt < maxAttempts && !acked; attempt++) {
            const baseline = this.chocoAckCount;
            this.chocolateOut!.send(pkt);
            acked = await this.waitForChocoAckAfter(baseline, ackTimeoutMs * (attempt + 1));
            if (!acked) {
              // Let any late ACK drain so it can't be mistaken for the next packet's ACK.
              await sleep(250);
              acked = this.chocoAckCount > baseline;
            }
          }
          if (!acked && !failed.includes(label)) failed.push(label);
          if (paceMs > 0) await sleep(paceMs);
        }
        step++;
      }
    } catch (err) {
      this.chocolateOut = null;
      if (this.chocolateIn) this.chocolateIn.onmidimessage = null;
      this.chocolateIn = null;
      this.notifyConnectionChange();

      const msg = `USB connection dropped while configuring Chocolate Plus (step ${pktIdx + 1}/${packets.length}). Make sure its side switch is set to U and click Sync All again.`;
      onProgress({ phase: 'error', current: step, total: totalSteps, message: msg });
      return { ok: false, userMessage: `${msg} (${(err as Error).message})`, failed };
    }

    if (failed.length > 0) {
      const msg = `Chocolate Plus did not confirm ${failed.length} setting(s): ${failed.slice(0, 6).join(', ')}${failed.length > 6 ? ' …' : ''}. Unplug and replug its USB (side switch on U), click Scan USB, then click Program Chocolate Plus.`;
      onProgress({ phase: 'error', current: step, total: totalSteps, message: msg });
      return { ok: false, userMessage: msg, failed };
    }

    const note = canVerify
      ? 'Chocolate Plus confirmed every footswitch setting.'
      : 'Chocolate Plus settings sent (its USB input port was not found, so writes could not be confirmed).';
    return { ok: true, userMessage: note, failed };
  }

  /** Re-programs only the Chocolate Plus (no 48-patch MS-50G sync). */
  public async configureChocolateOnly(
    onProgress: (p: SyncProgress) => void,
    delayMs: number = 80
  ): Promise<{ ok: boolean; userMessage: string }> {
    if (!this.chocolateOut) {
      return {
        ok: false,
        userMessage: 'Chocolate Plus is not connected. Plug it in via USB (side switch on U) and click Scan USB.',
      };
    }
    const packets = buildChocolateLiveConfigPackets();
    const res = await this.programChocolate(packets, onProgress, delayMs, 0, packets.length);
    if (res.ok) {
      onProgress({ phase: 'done', current: packets.length, total: packets.length, message: res.userMessage });
    }
    return { ok: res.ok, userMessage: res.userMessage };
  }

  /**
   * Writes all 48 managed patches (12 Gig Rigs + 36 Shadow Snapshots) to the Zoom MS-50G
   * and pushes the complete Single-Bank + Short/Long + Salfini VP-1 Expression config to Chocolate Plus.
   */
  public async syncAllToHardware(
    rigs: GigRig[],
    onProgress: (p: SyncProgress) => void,
    delayMs: number = 80
  ): Promise<{ ok: boolean; userMessage: string }> {
    if (!this.zoomOut && !this.chocolateOut) {
      return {
        ok: false,
        userMessage:
          'Neither your MS-50G nor your Chocolate Plus is connected over USB. Plug one or both in and click Scan USB first.',
      };
    }

    const patches48 = compileRigsTo48Patches(rigs);
    const chocoPackets = buildChocolateLiveConfigPackets();
    const totalSteps =
      (this.zoomOut ? patches48.length : 0) + (this.chocolateOut ? chocoPackets.length : 0);
    let step = 0;

    if (this.zoomOut) {
      let currentIdx = 0;
      let ackedCount = 0;
      // Hardware-verified: MS-70CDR 2.10 sends a 7-byte ACK [F0 52 00 61 00 00 F7] when 0x32 Store finishes.
      // Waiting for each ACK before sending the next patch prevents USB MIDI buffer overflow (which dropped patches 35..48).
      const waitForStoreAck = Boolean(this.zoomIn && delayMs > 0);
      const writeWaitMs = delayMs > 1 ? Math.max(delayMs, 220) : delayMs;
      const ackTimeoutMs = delayMs > 1 ? 5000 : 250;
      try {
        this.zoomOut.send(new Uint8Array([0xf0, 0x52, 0x00, this.zoomModelId, 0x50, 0xf7]));
        await sleep(delayMs);

        for (let idx = 0; idx < patches48.length; idx++) {
          currentIdx = idx;
          const rigNum = idx < 12 ? idx + 1 : Math.floor((idx - 12) / 3) + 1;
          const sceneName = idx < 12 ? 'Scene A' : `Scene ${['B', 'C', 'D'][(idx - 12) % 3]}`;
          const rigDisplay = `Rig ${String(rigNum).padStart(2, '0')} (${sceneName})`;
          onProgress({
            phase: 'ms50g',
            current: step + 1,
            total: totalSteps,
            message: `Syncing ${rigDisplay} to Zoom MS-50G...`,
          });

          this.zoomOut.send([0xc0, idx]);
          await sleep(delayMs);
          this.zoomOut.send(buildPatchWriteSysex(this.zoomModelId, idx, patches48[idx]));
          await sleep(writeWaitMs);

          const ackPromise = waitForStoreAck ? this.waitForZoomAck(ackTimeoutMs) : Promise.resolve(true);
          this.zoomOut.send(buildPatchStoreSysex(this.zoomModelId, idx));
          const acked = await ackPromise;
          if (acked) {
            ackedCount++;
          } else if (idx === 0) {
            try {
              this.zoomOut.send(new Uint8Array([0xf0, 0x52, 0x00, this.zoomModelId, 0x51, 0xf7]));
            } catch {
              // ignore exit-editor error
            }
            const msg = `Zoom MS-50G did not confirm saving Rig 01 (0/48 store ACKs) [model=0x${this.zoomModelId.toString(16)}, rx=${this.zoomRxCount}, last=${this.lastZoomRxSummary}]. Power-cycle USB, click Scan USB, and try Sync All again.`;
            onProgress({
              phase: 'error',
              current: step,
              total: totalSteps,
              message: msg,
            });
            return { ok: false, userMessage: msg };
          }
          await sleep(delayMs);
          step++;
        }

        this.zoomOut.send(new Uint8Array([0xf0, 0x52, 0x00, this.zoomModelId, 0x51, 0xf7]));
        await sleep(delayMs);
        this.zoomOut.send([0xc0, 0]);

        if (waitForStoreAck && ackedCount < patches48.length) {
          const msg = `Zoom MS-50G only confirmed ${ackedCount}/${patches48.length} patches [rx=${this.zoomRxCount}, last=${this.lastZoomRxSummary}]. Click Scan USB and try Sync All again.`;
          onProgress({
            phase: 'error',
            current: step,
            total: totalSteps,
            message: msg,
          });
          return { ok: false, userMessage: msg };
        }
      } catch (err) {
        const failedRig =
          currentIdx < 12 ? currentIdx + 1 : Math.floor((currentIdx - 12) / 3) + 1;
        const failedScene =
          currentIdx < 12 ? 'Scene A' : `Scene ${['B', 'C', 'D'][(currentIdx - 12) % 3]}`;
        this.zoomOut = null;
        if (this.zoomIn) this.zoomIn.onmidimessage = null;
        this.zoomIn = null;
        this.notifyConnectionChange();

        const msg = `USB connection dropped while syncing MS-50G on Rig ${String(failedRig).padStart(2, '0')} (${failedScene}). Check your Mini-USB cable and click Sync All again.`;
        onProgress({
          phase: 'error',
          current: step,
          total: totalSteps,
          message: msg,
        });
        return {
          ok: false,
          userMessage: `${msg} (${(err as Error).message})`,
        };
      }
    }

    let verifyNote = '';
    let verifyFailure = '';
    if (this.zoomOut && this.zoomIn && delayMs > 0) {
      const verify = await this.verifyZoomAgainstRigs(rigs, (p) =>
        onProgress({ ...p, phase: 'ms50g', current: step, total: totalSteps })
      );
      if (verify.ok) {
        verifyNote = ' MS-50G read-back verified.';
      } else if (verify.inconclusive) {
        verifyNote = ` Note: ${verify.userMessage}`;
      } else {
        // A real mismatch: still program the Chocolate Plus (it is independent), then report the failure.
        verifyFailure = verify.userMessage;
      }
    }

    if (this.chocolateOut) {
      const choco = await this.programChocolate(chocoPackets, onProgress, delayMs, step, totalSteps);
      step += chocoPackets.length;
      if (!choco.ok) {
        return { ok: false, userMessage: verifyFailure ? `${verifyFailure} ${choco.userMessage}` : choco.userMessage };
      }
    }

    if (verifyFailure) {
      onProgress({ phase: 'error', current: step, total: totalSteps, message: verifyFailure });
      return { ok: false, userMessage: verifyFailure };
    }

    onProgress({
      phase: 'done',
      current: totalSteps,
      total: totalSteps,
      message: 'All rigs & controller settings synced! Unplug USB, connect Wireless MIDI-B to MS-50G, and play.',
    });

    return {
      ok: true,
      userMessage:
        `Sync complete! Your 12 Gig Rigs, 48 Scene Snapshots, Chocolate Plus switches, and Salfini VP-1 Expression routing are ready for wireless stage play.${verifyNote}`,
    };
  }
}

export const webMidiService = new WebMidiService();

const PEDAL_SCENES = ['A', 'B', 'C', 'D'] as const;

/** Compares intended rigs against 48 raw patches read back from the MS-50G (On/Off + pedal model per slot). */
export function compareRigsToRaw48(rigs: GigRig[], raw48: Uint8Array[]): string[] {
  return compareRigsToRaw48Detailed(rigs, raw48).messages;
}

export function compareRigsToRaw48Detailed(
  rigs: GigRig[],
  raw48: Uint8Array[]
): { messages: string[]; patches: Set<number> } {
  const out: string[] = [];
  const bad = new Set<number>();
  for (let r = 0; r < 12 && r < rigs.length; r++) {
    const rig = rigs[r];
    PEDAL_SCENES.forEach((scene, sIdx) => {
      const patchIdx = sIdx === 0 ? r : 12 + r * 3 + (sIdx - 1);
      const raw = raw48[patchIdx];
      if (!raw) return;
      const { slots6 } = unpackRawPatch128(raw);
      const tag = `Rig ${String(r + 1).padStart(2, '0')} Scene ${scene}`;
      const before = out.length;
      if ((slots6[0].fxid & 0xffff) !== 0x0195) {
        out.push(`${tag}: SCENE controller missing from slot 1`);
      }
      const intended = rig.scenes[scene];
      for (let p = 0; p < 5; p++) {
        const want = intended[p];
        const got = slots6[p + 1];
        const name = getEffectDefinition(want.fxid)?.shortName ?? `Pedal ${p + 1}`;
        if (got.fxid !== want.fxid) {
          const gotName = getEffectDefinition(got.fxid)?.shortName ?? `fx 0x${got.fxid.toString(16)}`;
          out.push(`${tag}: Pedal ${p + 1} is ${gotName}, expected ${name}`);
        } else if (got.enabled !== want.enabled) {
          out.push(`${tag}: Pedal ${p + 1} (${name}) is ${got.enabled ? 'ON' : 'OFF'}, expected ${want.enabled ? 'ON' : 'OFF'}`);
        }
      }
      if (out.length > before) bad.add(patchIdx);
    });
  }
  return { messages: out, patches: bad };
}
