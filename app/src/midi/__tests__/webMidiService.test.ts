import { describe, it, expect } from 'vitest';
import { WebMidiService } from '../webMidiService';
import { STARTER_TEMPLATES } from '../../data/starterTemplates';

describe('WebMidiService resilience', () => {
  it('returns plain-English status when browser lacks WebMIDI support', async () => {
    const svc = new WebMidiService(null);
    const res = await svc.connect();
    expect(res.ok).toBe(false);
    expect(res.userMessage).toMatch(/Chrome or Microsoft Edge/i);
  });

  it('aborts cleanly with rig index if MS-50G USB cable disconnects mid-sync', async () => {
    let writes = 0;
    const mockZoomOut = {
      name: 'ZOOM MS Series',
      send: () => {
        writes++;
        if (writes === 6) throw new Error('Port disconnected');
      },
    };
    const svc = new WebMidiService({ zoomOut: mockZoomOut as any });
    const rigs = Array.from({ length: 12 }, (_, i) => STARTER_TEMPLATES[0].createRig(i));
    const result = await svc.syncAllToHardware(rigs, () => {}, 0);
    expect(result.ok).toBe(false);
    expect(result.userMessage).toMatch(/USB connection dropped while syncing/i);
  });
});
