import { getEffectDefinition } from '../data/effectCatalog';
import { GigRig, SceneId, SyncProgress } from '../types/rig';
import {
  buildChocolateDiscoverySysex,
  buildChocolateLiveConfigPackets,
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
      if (this.chocolateOut) {
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

    const raw48: Uint8Array[] = [];
    this.zoomOut.send(new Uint8Array([0xf0, 0x52, 0x00, this.zoomModelId, 0x50, 0xf7]));
    await sleep(delayMs > 0 ? Math.max(delayMs, 80) : 0);

    for (let idx = 0; idx < 48; idx++) {
      const rigLabel =
        idx < 12
          ? `Gig Rig ${String(idx + 1).padStart(2, '0')}`
          : `Rig ${String(Math.floor((idx - 12) / 3) + 1).padStart(2, '0')} Scene ${['B', 'C', 'D'][(idx - 12) % 3]}`;

      onProgress({
        phase: 'backup',
        current: idx + 1,
        total: 48,
        message: `Reading ${rigLabel} from Zoom MS-50G...`,
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

        this.zoomOut.send([0xc0, idx]);
        await sleep(delayMs);
        this.zoomOut.send(buildPatchRequestSysex(this.zoomModelId));

        const sysex146 = await dumpPromise;
        raw48.push(decodePatchReadSysex(sysex146));
      } catch (err) {
        onProgress({
          phase: 'error',
          current: idx,
          total: 48,
          message: `Failed reading ${rigLabel} from MS-50G (${(err as Error).message}).`,
        });
        return {
          ok: false,
          userMessage: `Could not read ${rigLabel} from MS-50G (${(err as Error).message}).`,
        };
      }
    }

    try {
      this.zoomOut.send(new Uint8Array([0xf0, 0x52, 0x00, this.zoomModelId, 0x51, 0xf7]));
      await sleep(delayMs);
      this.zoomOut.send([0xc0, 0]);
    } catch {
      // Ignore post-read exit-editor / PC return failure
    }

    const rigs = decompile48PatchesToRigs(raw48);
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

  private readCurrentPatchDump(timeoutMs: number): Promise<Uint8Array | null> {
    if (!this.zoomOut || !this.zoomIn || timeoutMs <= 0) {
      return Promise.resolve(null);
    }
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (this.pendingZoomDumpResolve) {
          this.pendingZoomDumpResolve = null;
          resolve(null);
        }
      }, timeoutMs);
      this.pendingZoomDumpResolve = (bytes) => {
        clearTimeout(timer);
        resolve(bytes);
      };
      this.zoomOut!.send(buildPatchRequestSysex(this.zoomModelId));
    });
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
      // Legacy MS-50G / MS-70CDR (MSOG) does NOT send a 0x00 SysEx ACK after 0x32 Store;
      // verify real hardware persistence via 0x29 read-back dump on Rig 01 and the final slot.
      const verifyReadback = Boolean(this.zoomIn && delayMs > 0);
      const writeWaitMs = delayMs > 1 ? Math.max(delayMs, 180) : delayMs;
      const storeWaitMs = delayMs > 1 ? Math.max(delayMs, 350) : delayMs;
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
          this.zoomOut.send(buildPatchStoreSysex(this.zoomModelId, idx));
          await sleep(storeWaitMs);
          step++;
        }

        // Exit Editor Mode (0x51) so MS-50G / MS-70CDR finishes committing flash before read-back verification
        this.zoomOut.send(new Uint8Array([0xf0, 0x52, 0x00, this.zoomModelId, 0x51, 0xf7]));
        await sleep(delayMs > 1 ? 400 : delayMs);

        if (verifyReadback) {
          this.zoomOut.send(new Uint8Array([0xf0, 0x52, 0x00, this.zoomModelId, 0x50, 0xf7]));
          await sleep(delayMs);
          this.zoomOut.send([0xc0, 0]);
          await sleep(delayMs);
          const dump = await this.readCurrentPatchDump(1200);
          this.zoomOut.send(new Uint8Array([0xf0, 0x52, 0x00, this.zoomModelId, 0x51, 0xf7]));
          await sleep(delayMs);
          if (!dump) {
            const msg = `Zoom MS-50G did not reply to post-sync read-back verification [model=0x${this.zoomModelId.toString(16)}, rx=${this.zoomRxCount}, last=${this.lastZoomRxSummary}]. Power-cycle USB, click Scan USB, and click Read from MS-50G to confirm your 48 patches.`;
            onProgress({
              phase: 'error',
              current: step,
              total: totalSteps,
              message: msg,
            });
            return { ok: false, userMessage: msg };
          }
        }

        this.zoomOut.send([0xc0, 0]);
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

    if (this.chocolateOut) {
      let pktIdx = 0;
      try {
        for (let i = 0; i < chocoPackets.length; i++) {
          pktIdx = i;
          onProgress({
            phase: 'chocolate',
            current: step + 1,
            total: totalSteps,
            message: 'Configuring Chocolate Plus footswitches & Salfini VP-1 Expression port...',
          });
          this.chocolateOut.send(chocoPackets[i]);
          await sleep(delayMs);
          step++;
        }
      } catch (err) {
        this.chocolateOut = null;
        if (this.chocolateIn) this.chocolateIn.onmidimessage = null;
        this.chocolateIn = null;
        this.notifyConnectionChange();

        const msg = `USB connection dropped while configuring Chocolate Plus (step ${pktIdx + 1}/${chocoPackets.length}). Make sure its side switch is set to U and click Sync All again.`;
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

    onProgress({
      phase: 'done',
      current: totalSteps,
      total: totalSteps,
      message: 'All rigs & controller settings synced! Unplug USB, connect Wireless MIDI-B to MS-50G, and play.',
    });

    return {
      ok: true,
      userMessage:
        'Sync complete! Your 12 Gig Rigs, 48 Scene Snapshots, Chocolate Plus switches, and Salfini VP-1 Expression routing are ready for wireless stage play.',
    };
  }
}

export const webMidiService = new WebMidiService();
