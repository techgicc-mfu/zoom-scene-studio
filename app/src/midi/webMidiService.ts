import { getEffectDefinition } from '../data/effectCatalog';
import { GigRig, SceneId, SyncProgress } from '../types/rig';
import {
  buildChocolateDiscoverySysex,
  buildChocolateLiveConfigPackets,
  SCENE_CC_VALUES,
} from './chocolateProtocol';
import {
  buildPatchStoreSysex,
  buildPatchWriteSysex,
  compileRigsTo48Patches,
} from './zoomProtocol';

export interface MidiPortLike {
  id?: string;
  name?: string | null;
  send: (data: number[] | Uint8Array) => void;
}

export interface MidiInputLike {
  id?: string;
  name?: string | null;
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

export class WebMidiService {
  private zoomOut: MidiPortLike | null = null;
  private zoomIn: MidiInputLike | null = null;
  private chocolateOut: MidiPortLike | null = null;
  private chocolateIn: MidiInputLike | null = null;
  private zoomModelId: 0x58 | 0x61 = 0x61; // MIDISTOMP V2.0 defaults to 0x61 (also checks 0x58)
  private injected: InjectedPorts | null | undefined;
  private expressionListeners: Set<(ccVal: number) => void> = new Set();

  constructor(injected?: InjectedPorts | null) {
    this.injected = injected;
    if (injected && typeof injected === 'object') {
      this.zoomOut = injected.zoomOut ?? null;
      this.zoomIn = injected.zoomIn ?? null;
      this.chocolateOut = injected.chocolateOut ?? null;
      this.chocolateIn = injected.chocolateIn ?? null;
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

      for (const output of access.outputs.values()) {
        const label = String(output.name || '').toLowerCase();
        if (label.includes('zoom') || label.includes('ms-50') || label.includes('ms-70') || label.includes('ms series')) {
          this.zoomOut = output;
        } else if (
          label.includes('sinco') ||
          label.includes('footctrl') ||
          label.includes('chocolate') ||
          label.includes('m-vave') ||
          label.includes('usb midi')
        ) {
          this.chocolateOut = output;
        }
      }

      for (const input of access.inputs.values()) {
        const label = String(input.name || '').toLowerCase();
        if (label.includes('zoom') || label.includes('ms-50') || label.includes('ms-70') || label.includes('ms series')) {
          this.zoomIn = input;
          input.onmidimessage = (ev: { data: Uint8Array }) => this.handleZoomReply(ev.data);
        } else if (
          label.includes('sinco') ||
          label.includes('footctrl') ||
          label.includes('chocolate') ||
          label.includes('m-vave') ||
          label.includes('usb midi')
        ) {
          this.chocolateIn = input;
          input.onmidimessage = (ev: { data: Uint8Array }) => this.handleChocolateInput(ev.data);
        }
      }

      // Query Zoom Identity Request to detect 0x58 (MS-50G) vs 0x61 (MIDISTOMP V2.0 / 70CDR)
      if (this.zoomOut) {
        this.zoomOut.send(new Uint8Array([0xf0, 0x7e, 0x00, 0x06, 0x01, 0xf7]));
        this.zoomOut.send(new Uint8Array([0xf0, 0x52, 0x00, 0x58, 0x50, 0xf7]));
        this.zoomOut.send(new Uint8Array([0xf0, 0x52, 0x00, 0x61, 0x50, 0xf7]));
      }
      if (this.chocolateOut) {
        this.chocolateOut.send(buildChocolateDiscoverySysex());
      }

      const status = this.getStatus();
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
    // Universal Identity Reply: F0 7E 00 06 02 52 <modelId> ...
    if (data.length >= 7 && data[0] === 0xf0 && data[1] === 0x7e && data[5] === 0x52) {
      if (data[6] === 0x58 || data[6] === 0x61) {
        this.zoomModelId = data[6];
      }
    }
  }

  private handleChocolateInput(data: Uint8Array): void {
    // Control Change message 0xB0..0xBF: [status, ccNumber, ccValue]
    if (data.length >= 3 && (data[0] & 0xf0) === 0xb0) {
      const ccValue = data[2] & 0x7f;
      for (const listener of this.expressionListeners) {
        listener(ccValue);
      }
    }
  }

  /** Sends live MIDISTOMP CC preview when the user clicks a Scene or turns a pedal knob on screen. */
  public sendScenePreview(scene: SceneId): void {
    if (!this.zoomOut) return;
    try {
      this.zoomOut.send([0xb0, 15, SCENE_CC_VALUES[scene]]);
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
   * Writes all 48 managed patches (12 Gig Rigs + 36 Shadow Snapshots) to the Zoom MS-50G
   * and pushes the Single-Bank + Salfini VP-1 Expression config to the Chocolate Plus.
   */
  public async syncAllToHardware(
    rigs: GigRig[],
    onProgress: (p: SyncProgress) => void,
    delayMs: number = 40
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
      try {
        // Enable parameter/patch write mode
        this.zoomOut.send(new Uint8Array([0xf0, 0x52, 0x00, this.zoomModelId, 0x50, 0xf7]));
        await sleep(delayMs);

        for (let idx = 0; idx < patches48.length; idx++) {
          const rigDisplay = idx < 12 ? `Gig Rig ${String(idx + 1).padStart(2, '0')}` : `Scene Memory #${idx + 1}`;
          onProgress({
            phase: 'ms50g',
            current: step + 1,
            total: totalSteps,
            message: `Syncing ${rigDisplay} to Zoom MS-50G...`,
          });

          // 1. Select memory slot 0..47, 2. Push 146B patch buffer (0x28), 3. Commit to NVRAM (0x32)
          this.zoomOut.send([0xc0, idx]);
          await sleep(delayMs);
          this.zoomOut.send(buildPatchWriteSysex(this.zoomModelId, idx, patches48[idx]));
          await sleep(delayMs);
          this.zoomOut.send(buildPatchStoreSysex(this.zoomModelId, idx));
          await sleep(delayMs);
          step++;
        }

        // Return pedal neatly to Gig Rig 01 (Scene A) ready to play
        this.zoomOut.send([0xc0, 0]);
      } catch (err) {
        const failedRig = Math.min(12, (step % 12) + 1);
        onProgress({
          phase: 'error',
          current: step,
          total: totalSteps,
          message: `USB connection dropped while syncing MS-50G (stopped around Rig ${failedRig}).`,
        });
        return {
          ok: false,
          userMessage: `USB connection dropped while syncing MS-50G (${(err as Error).message}). Check your Mini-USB cable and click Sync All again.`,
        };
      }
    }

    if (this.chocolateOut) {
      try {
        for (let i = 0; i < chocoPackets.length; i++) {
          onProgress({
            phase: 'chocolate',
            current: step + 1,
            total: totalSteps,
            message: 'Configuring Chocolate Plus switches & Salfini VP-1 Expression port...',
          });
          this.chocolateOut.send(chocoPackets[i]);
          await sleep(delayMs);
          step++;
        }
      } catch (err) {
        return {
          ok: false,
          userMessage: `USB connection dropped while configuring Chocolate Plus (${(err as Error).message}). Make sure its side switch is set to U while plugged into the PC.`,
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
