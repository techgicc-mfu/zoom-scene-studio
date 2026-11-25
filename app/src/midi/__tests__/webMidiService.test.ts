import { describe, it, expect } from 'vitest';
import { WebMidiService } from '../webMidiService';
import { STARTER_TEMPLATES } from '../../data/starterTemplates';
import { buildPatchWriteSysex, packRawPatch128 } from '../zoomProtocol';

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
});
