import { describe, it, expect, vi } from 'vitest';
import { WebMidiService } from '../webMidiService';
import { STARTER_TEMPLATES } from '../../data/starterTemplates';
import {
  compileRigsTo48Patches,
  buildPatchWriteSysex,
  decodePatchReadSysex,
  packRawPatch128,
  unpackRawPatch128,
} from '../zoomProtocol';

describe('WebMidiService resilience & two-way sync', () => {
  it('returns plain-English status when browser lacks WebMIDI support', async () => {
    const svc = new WebMidiService(null);
    const res = await svc.connect();
    expect(res.ok).toBe(false);
    expect(res.userMessage).toMatch(/Chrome or Microsoft Edge/i);
  });

  it('aborts cleanly with correct Shadow Rig index if MS-50G USB cable disconnects mid-sync', async () => {
    let writes = 0;
    const mockZoomOut = {
      name: 'ZOOM MS Series',
      send: () => {
        writes++;
        // step 0..11 = 12*3 writes = 36; idx 14 (Rig 01 Scene D) triggers throw
        if (writes >= 45) throw new Error('Port disconnected');
      },
    };
    const svc = new WebMidiService({ zoomOut: mockZoomOut as any });
    const rigs = Array.from({ length: 12 }, (_, i) => STARTER_TEMPLATES[0].createRig(i));
    const events: any[] = [];
    const result = await svc.syncAllToHardware(rigs, (p) => events.push(p), 0);
    expect(result.ok).toBe(false);
    expect(result.userMessage).toMatch(/Rig 0?1/i);
    expect(events[events.length - 1]?.phase).toBe('error');
  });

  it('emits phase=error and resets UI sync state if Chocolate Plus disconnects mid-sync', async () => {
    const mockZoomOut = { name: 'ZOOM MS Series', send: () => {} };
    let chocoWrites = 0;
    const mockChocoOut = {
      name: 'SinCo Chocolate',
      send: () => {
        chocoWrites++;
        if (chocoWrites === 3) throw new Error('USB unplugged');
      },
    };
    const svc = new WebMidiService({ zoomOut: mockZoomOut as any, chocolateOut: mockChocoOut as any });
    const rigs = Array.from({ length: 12 }, (_, i) => STARTER_TEMPLATES[0].createRig(i));
    const events: any[] = [];
    const result = await svc.syncAllToHardware(rigs, (p) => events.push(p), 0);
    expect(result.ok).toBe(false);
    expect(events[events.length - 1]?.phase).toBe('error');
    expect(events[events.length - 1]?.message).toMatch(/Chocolate Plus/i);
  });

  it('filters non-expression CCs (CC 15/80) out of Salfini VP-1 live meter', () => {
    const chocoIn: any = { name: 'Chocolate Plus', onmidimessage: null };
    const svc = new WebMidiService({
      chocolateOut: { name: 'Chocolate Plus', send: () => {} },
      chocolateIn: chocoIn,
    });
    const received: number[] = [];
    svc.onExpressionSweep((v) => received.push(v));
    // Directly simulate MIDI events on private/bound handler by connecting injected handler:
    (svc as any).handleChocolateInput(new Uint8Array([0xb0, 15, 84])); // Scene C tap -> ignored
    (svc as any).handleChocolateInput(new Uint8Array([0xb0, 80, 127])); // Prev Rig hold -> ignored
    (svc as any).handleChocolateInput(new Uint8Array([0xb0, 16, 77])); // Expression CC 16 -> accepted
    expect(received).toEqual([77]);
  });

  it('reads all 48 patches from MS-50G via 0x29 request -> 0x28 dump -> decompile48PatchesToRigs', async () => {
    const rigs = Array.from({ length: 12 }, (_, i) => STARTER_TEMPLATES[i % STARTER_TEMPLATES.length].createRig(i));
    const zoomIn: any = { name: 'ZOOM MS Series', onmidimessage: null };
    let currentSlot = 0;
    const zoomOut: any = {
      name: 'ZOOM MS Series',
      send: (bytes: Uint8Array | number[]) => {
        const arr = Array.from(bytes);
        if (arr[0] === 0xc0) currentSlot = arr[1];
        if (arr[0] === 0xf0 && arr[4] === 0x29) {
          const sampleRaw = packRawPatch128(
            [
              { enabled: true, fxid: 0x02000195, params: [0, 0, 12, 0, 0, 0, 0, 0, 0] },
              ...rigs[0].scenes.A,
            ],
            `READ ${currentSlot}`,
            118
          );
          const dump = buildPatchWriteSysex(0x61, currentSlot, sampleRaw);
          setTimeout(() => zoomIn.onmidimessage?.({ data: dump }), 0);
        }
      },
    };
    const svc = new WebMidiService({ zoomOut, zoomIn, zoomModelId: 0x61 });
    const res = await svc.readAllFromHardware(() => {}, 0);
    expect(res.ok).toBe(true);
    expect(res.rigs).toHaveLength(12);
    expect(res.rigs?.[0].name).toBe('READ 0');
  });

  it('sends live PC rig-select and CC 17 trim preview messages and rejects unverified USB MIDI ports', async () => {
    const sent: number[][] = [];
    const svc = new WebMidiService({
      zoomOut: { name: 'ZOOM MS Series', send: (d) => sent.push(Array.from(d)) },
    });
    svc.sendRigSelectPreview(3);
    svc.sendTrimPreview(18);
    expect(sent).toEqual([
      [0xc0, 3],
      [0xb0, 17, 95],
    ]);

    // Mock navigator.requestMIDIAccess with generic "USB MIDI Interface" that does not answer Chocolate discovery
    const origNav = (globalThis as any).navigator;
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: {
        requestMIDIAccess: async () => ({
          outputs: new Map([['g1', { id: 'g1', name: 'USB MIDI Interface', send: () => {} }]]),
          inputs: new Map([['g2', { id: 'g2', name: 'USB MIDI Interface', onmidimessage: null }]]),
          onstatechange: null,
        }),
      },
    });
    const probeSvc = new WebMidiService();
    const res = await probeSvc.connect();
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: origNav });
    expect(res.chocolateConnected).toBe(false);
  });

  it('waits for Zoom 7-byte 0x00 Store ACK per patch before advancing when zoomIn is connected', async () => {
    const { zoomIn, zoomOut, sentCmds } = makeEmulatedZoom();
    const svc = new WebMidiService({ zoomOut, zoomIn, zoomModelId: 0x61 });
    const rigs = Array.from({ length: 12 }, (_, i) => STARTER_TEMPLATES[0].createRig(i));
    const res = await svc.syncAllToHardware(rigs, () => {}, 1);
    expect(res.ok).toBe(true);
    expect(sentCmds[0]).toBe(0x50);
    expect(sentCmds.filter((c) => c === 0x32)).toHaveLength(48);
    expect(sentCmds.filter((c) => c === 0x29)).toHaveLength(48); // read-back verify
    expect(sentCmds[sentCmds.length - 1]).toBe(0x51);
  }, 60000);

  /** Emulates MS-50G patch memory: PC loads a slot into the edit buffer, 0x28 writes it, 0x32 stores it, 0x29 dumps it. */
  function makeEmulatedZoom(opts: { corrupt?: (idx: number, sysex: Uint8Array) => Uint8Array } = {}) {
    const zoomIn: any = { name: 'ZOOM MS Series', onmidimessage: null };
    const memory = new Map<number, Uint8Array>();
    let buffer: Uint8Array | null = null;
    let cur = 0;
    const sentCmds: number[] = [];
    const reply = (bytes: number[] | Uint8Array) =>
      setTimeout(() => zoomIn.onmidimessage?.({ data: new Uint8Array(bytes) }), 0);
    const zoomOut: any = {
      name: 'ZOOM MS Series',
      send: (d: Uint8Array | number[]) => {
        const arr = new Uint8Array(Array.from(d));
        if (arr[0] === 0xc0) {
          cur = arr[1];
          buffer = memory.get(cur) ?? null;
          return;
        }
        if (arr[0] !== 0xf0 || arr[1] !== 0x52) return;
        sentCmds.push(arr[4]);
        if (arr[4] === 0x28) buffer = arr;
        if (arr[4] === 0x32) {
          const slot = arr[8];
          if (buffer) memory.set(slot, opts.corrupt ? opts.corrupt(slot, buffer) : buffer);
          reply([0xf0, 0x52, 0x00, 0x61, 0x00, 0x00, 0xf7]);
        }
        if (arr[4] === 0x29 && buffer) reply(buffer);
      },
    };
    return { zoomIn, zoomOut, sentCmds };
  }

  it('reads every patch back after syncing and reports success when the MS-50G matches', async () => {
    const { zoomIn, zoomOut } = makeEmulatedZoom();
    const svc = new WebMidiService({ zoomOut, zoomIn, zoomModelId: 0x61 });
    const rigs = Array.from({ length: 12 }, (_, i) => STARTER_TEMPLATES[i % STARTER_TEMPLATES.length].createRig(i));
    const res = await svc.syncAllToHardware(rigs, () => {}, 2);
    expect(res.ok).toBe(true);
    expect(res.userMessage).toMatch(/verified/i);
  }, 60000);

  it('flags a pedal whose On/Off did not survive on the MS-50G (e.g. Drive OFF in Scene B)', async () => {
    const rigs = Array.from({ length: 12 }, (_, i) => STARTER_TEMPLATES[i % STARTER_TEMPLATES.length].createRig(i));
    rigs[0].scenes.B[1].enabled = true;
    const { zoomIn, zoomOut } = makeEmulatedZoom({
      corrupt: (slot, sysex) => {
        if (slot !== 12) return sysex; // Rig 01 Scene B shadow record
        const raw = decodePatchReadSysex(sysex);
        const parsed = unpackRawPatch128(raw);
        parsed.slots6[2] = { ...parsed.slots6[2], enabled: false };
        return buildPatchWriteSysex(0x61, slot, packRawPatch128(parsed.slots6, parsed.name, parsed.tempo));
      },
    });
    const svc = new WebMidiService({ zoomOut, zoomIn, zoomModelId: 0x61 });
    const res = await svc.syncAllToHardware(rigs, () => {}, 2);
    expect(res.ok).toBe(false);
    expect(res.userMessage).toMatch(/Rig 01 Scene B: Pedal 2 .* is OFF, expected ON/);
  }, 60000);

  it('retries unacknowledged Chocolate Plus writes and names the switch that never confirmed', async () => {
    const chocoIn: any = { name: 'Chocolate Plus', onmidimessage: null };
    const chocoOut: any = {
      name: 'Chocolate Plus',
      send: (d: Uint8Array) => {
        const addr = (d[9] & 0x7f) | ((d[10] & 0x7f) << 7) | ((d[11] & 0x7f) << 14);
        // Switch D (record base 1344) never ACKs; everything else ACKs immediately.
        if (addr >= 1344 && addr < 1344 + 417) return;
        setTimeout(() => chocoIn.onmidimessage?.({ data: new Uint8Array([0xf0, 0x00, 0x32, 0x01, 0xf7]) }), 0);
      },
    };
    vi.useFakeTimers({ shouldAdvanceTime: true, advanceTimeDelta: 50 });
    try {
      const svc = new WebMidiService({ chocolateOut: chocoOut, chocolateIn: chocoIn });
      const p = svc.configureChocolateOnly(() => {}, 2);
      await vi.runAllTimersAsync();
      const res = await p;
      expect(res.ok).toBe(false);
      expect(res.userMessage).toMatch(/Switch D/);
      expect(res.userMessage).not.toMatch(/Switch B/);
    } finally {
      vi.useRealTimers();
    }
  }, 120000);

  it('passes footswitch MIDI from the Chocolate Plus to Footswitch Tester listeners', () => {
    const chocoIn: any = { name: 'Chocolate Plus', onmidimessage: null };
    const svc = new WebMidiService({ chocolateOut: { name: 'Chocolate Plus', send: () => {} }, chocolateIn: chocoIn });
    const got: number[][] = [];
    svc.onChocolateMidi((d) => got.push(Array.from(d)));
    chocoIn.onmidimessage({ data: new Uint8Array([0xb0, 15, 42]) });
    chocoIn.onmidimessage({ data: new Uint8Array([0xf0, 0x00, 0x32, 0x01, 0xf7]) });
    expect(got).toEqual([[0xb0, 15, 42]]);
  });

  it('fails loudly instead of claiming synced when MS-50G never sends 0x00 Store ACK', async () => {
    const sentCmds: number[] = [];
    const zoomIn: any = { name: 'ZOOM MS Series', onmidimessage: null };
    const zoomOut: any = {
      name: 'ZOOM MS Series',
      send: (d: Uint8Array | number[]) => {
        const arr = Array.from(d);
        if (arr[0] === 0xf0 && arr[1] === 0x52) sentCmds.push(arr[4]);
      },
    };
    const svc = new WebMidiService({ zoomOut, zoomIn, zoomModelId: 0x61 });
    const rigs = Array.from({ length: 12 }, (_, i) => STARTER_TEMPLATES[0].createRig(i));
    const events: any[] = [];
    const res = await svc.syncAllToHardware(rigs, (p) => events.push(p), 1);
    expect(res.ok).toBe(false);
    expect(res.userMessage).toMatch(/0\/48 store ACKs/i);
    expect(events[events.length - 1]?.phase).toBe('error');
    expect(sentCmds.filter((c) => c === 0x32)).toHaveLength(1);
    expect(sentCmds[sentCmds.length - 1]).toBe(0x51);
  });

  function slowLoadZoom(mem: Uint8Array[], loadMs: number) {
    const zoomIn: any = { name: 'ZOOM MS Series', onmidimessage: null };
    let cur = 0;
    let prev = 0;
    let pcAt = 0;
    const zoomOut: any = {
      name: 'ZOOM MS Series',
      send: (bytes: Uint8Array | number[]) => {
        const a = Array.from(bytes);
        if (a[0] === 0xc0) {
          prev = cur;
          cur = a[1];
          pcAt = Date.now();
        }
        if (a[0] === 0xf0 && a[4] === 0x29) {
          // a patch that has not finished loading still answers with the previous one
          const idx = Date.now() - pcAt < loadMs ? prev : cur;
          const dump = buildPatchWriteSysex(0x61, idx, mem[idx]);
          setTimeout(() => zoomIn.onmidimessage?.({ data: dump }), 0);
        }
      },
    };
    return new WebMidiService({ zoomOut, zoomIn, zoomModelId: 0x61 });
  }

  it('read-back verify tolerates a slow patch load (stale first read) and still passes', async () => {
    const rigs = Array.from({ length: 12 }, (_, i) => STARTER_TEMPLATES[i % STARTER_TEMPLATES.length].createRig(i));
    const mem = compileRigsTo48Patches(rigs);
    const svc = slowLoadZoom(mem, 100);
    const res = await svc.verifyZoomAgainstRigs(rigs, () => {}, 25, 600);
    expect(res.ok).toBe(true);
  }, 60000);

  it('read-back verify reports what the MS-50G actually holds when the writes did not stick', async () => {
    const rigs = Array.from({ length: 12 }, (_, i) => STARTER_TEMPLATES[i % STARTER_TEMPLATES.length].createRig(i));
    const other = Array.from({ length: 12 }, (_, i) => STARTER_TEMPLATES[(i + 1) % STARTER_TEMPLATES.length].createRig(i));
    const mem = compileRigsTo48Patches(other);
    const svc = slowLoadZoom(mem, 0);
    const res = await svc.verifyZoomAgainstRigs(rigs, () => {}, 25, 600);
    expect(res.ok).toBe(false);
    expect(res.userMessage).toMatch(/holds ".+"/);
    expect(res.userMessage).toMatch(/of 48 patches/);
  }, 90000);

  it('read-back that always returns the same patch is reported as inconclusive, not as a failed write', async () => {
    const rigs = Array.from({ length: 12 }, (_, i) => STARTER_TEMPLATES[i % STARTER_TEMPLATES.length].createRig(i));
    const mem = compileRigsTo48Patches(rigs);
    const zoomIn: any = { name: 'ZOOM MS Series', onmidimessage: null };
    const zoomOut: any = {
      name: 'ZOOM MS Series',
      send: (bytes: Uint8Array | number[]) => {
        const a = Array.from(bytes);
        if (a[0] === 0xf0 && a[4] === 0x29) {
          const dump = buildPatchWriteSysex(0x61, 47, mem[47]); // edit buffer stuck on the last patch written
          setTimeout(() => zoomIn.onmidimessage?.({ data: dump }), 0);
        }
      },
    };
    const svc = new WebMidiService({ zoomOut, zoomIn, zoomModelId: 0x61 });
    const res = await svc.verifyZoomAgainstRigs(rigs, () => {}, 1, 600);
    expect(res.ok).toBe(false);
    expect(res.inconclusive).toBe(true);
    expect(res.userMessage).toMatch(/inconclusive/i);
  }, 90000);
});
