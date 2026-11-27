import { describe, it, expect } from 'vitest';
import { WebMidiService } from '../webMidiService';
import { buildZip, crc32, parseFileListReply, unpack7 } from '../zoomFiles';

const hex = (s: string) => new Uint8Array(s.trim().split(/\s+/).map((h) => parseInt(h, 16)));

describe('MS-50G file protocol helpers', () => {
  it('parses real file-list replies captured from an MS-50G', () => {
    const flst = parseFileListReply(
      hex('f0 52 00 61 60 04 25 00 00 17 00 00 00 00 00 46 4c 53 54 5f 53 45 51 2e 5a 44 54 00 00 00 0c 20 00 00 00 00 00 00 00 00 f7')
    );
    expect(flst).toEqual({ name: 'FLST_SEQ.ZDT', size: 12 + 0x20 * 128 });
    const cmn = parseFileListReply(
      hex('f0 52 00 61 60 04 25 00 00 17 00 00 00 00 00 43 4d 4e 5f 44 52 56 2e 5a 44 4c 00 00 00 00 15 33 01 00 00 00 00 00 00 00 f7')
    );
    expect(cmn).toEqual({ name: 'CMN_DRV.ZDL', size: 0x15 + 0x33 * 128 + 0x01 * 16384 });
    const ms = parseFileListReply(
      hex('f0 52 00 61 60 04 25 00 00 17 00 00 00 00 00 4d 53 5f 31 39 35 39 2e 5a 44 4c 00 00 00 00 18 62 00 00 00 00 00 00 00 00 f7')
    );
    expect(ms?.name).toBe('MS_1959.ZDL');
    expect(parseFileListReply(hex('f0 52 00 61 60 03 00 00 00 00 00 f7'))).toBeNull();
  });

  it('crc32 matches the standard check value', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });

  it('builds a valid stored zip', () => {
    const zip = buildZip([{ name: 'A.ZDL', data: new Uint8Array([1, 2, 3]) }]);
    expect(Array.from(zip.slice(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04]);
    expect(Array.from(zip.slice(-22, -18))).toEqual([0x50, 0x4b, 0x05, 0x06]);
  });
});

/** Mock MS-50G file system (list + read) using the documented message layouts. */
function makeFileDevice(files: Record<string, Uint8Array>, order: 'lsbFirst' | 'msbFirst', chunk = 100, opts: { plainOnly?: boolean; needAddr?: boolean } = {}) {
  const PLAIN = opts.plainOnly ?? true; // the real MS-50G only understands plain ASCII names
  let lastResult: number[] = [0, 0, 0, 0, 0];
  const ADDR = [0x74, 0x6f, 0x40, 0x0f, 0x01];
  const zoomIn: any = { name: 'ZOOM MS Series', onmidimessage: null };
  const names = Object.keys(files);
  let li = 0;
  let cur: string | null = null;
  let pos = 0;
  const sent: number[][] = [];
  const reply = (d: number[]) => setTimeout(() => zoomIn.onmidimessage?.({ data: new Uint8Array(d) }), 0);
  const entry = (n: string) => {
    const f = files[n];
    const nm = Array.from(n).map((c) => c.charCodeAt(0));
    const size = f.length;
    const body = [0xf0, 0x52, 0x00, 0x61, 0x60, 0x04, 0x25, 0, 0, 0x17, 0, 0, 0, 0, 0, ...nm];
    while (body.length < 30) body.push(0);
    body.push(size & 0x7f, (size >> 7) & 0x7f, (size >> 14) & 0x7f, (size >> 21) & 0x7f, 0, 0, 0, 0, 0xf7);
    return body;
  };
  const pack = (block: Uint8Array) => {
    const out: number[] = [];
    for (let i = 0; i < block.length; i += 7) {
      let hdr = 0;
      const grp: number[] = [];
      for (let j = 0; j < 7 && i + j < block.length; j++) {
        const b = block[i + j];
        const bit = b >> 7;
        hdr |= bit << (order === 'lsbFirst' ? j : 6 - j);
        grp.push(b & 0x7f);
      }
      out.push(hdr, ...grp);
    }
    return out;
  };
  const zoomOut: any = {
    name: 'ZOOM MS Series',
    send: (b: any) => {
      const a = Array.from(b as number[]);
      sent.push(a);
      if (a[4] !== 0x60) return;
      const cmd = a[5];
      if (cmd === 0x25 && a[8] === 0x2a) {
        li = 0;
        return reply(li < names.length ? entry(names[li++]) : [0xf0, 0x52, 0, 0x61, 0x60, 0x03, 0, 0xf7]);
      }
      if (cmd === 0x26) return reply(li < names.length ? entry(names[li++]) : [0xf0, 0x52, 0, 0x61, 0x60, 0x03, 0, 0xf7]);
      if (cmd === 0x25) {
        let nm = '';
        for (let i = 8; i < a.length - 1 && a[i] !== 0; i++) nm += String.fromCharCode(a[i]);
        lastResult = PLAIN && files[nm] ? [0, 0, 0, 0, 0] : PLAIN ? [0x7a, 0x7f, 0x7f, 0x7f, 0x0f] : [0, 0, 0, 0, 0];
        cur = null;
        return reply([0xf0, 0x52, 0, 0x61, 0x60, 0x03, ...lastResult, 0xf7]);
      }
      if (cmd === 0x20) {
        let nm = '';
        if (PLAIN) for (let i = 16; i < a.length - 1 && a[i] !== 0; i++) nm += String.fromCharCode(a[i]);
        else for (let i = 16; i + 1 < a.length - 1; i += 2) nm += String.fromCharCode(a[i]);
        cur = files[nm] ? nm : null;
        lastResult = cur ? [0, 0, 0, 0, 0] : [0x7a, 0x7f, 0x7f, 0x7f, 0x0f];
        pos = 0;
        return reply([0xf0, 0x52, 0, 0x61, 0x60, 0x04, 0x20, 0, 0, 0x04, 0, ...ADDR, 0, 0, 0, 0, 0, 0xf7]);
      }
      if (cmd === 0x05) {
        if (pending) {
          const p = pending;
          pending = null;
          return reply(p);
        }
        return reply([0xf0, 0x52, 0, 0x61, 0x60, 0x03, ...lastResult, 0xf7]);
      }
      if (cmd === 0x22) {
        if (opts.needAddr && !ADDR.every((v, i) => a[6 + i] === v)) {
          pending = [0xf0, 0x52, 0, 0x61, 0x60, 0x03, 0x7f, 0x7f, 0x7f, 0x7f, 0x0f, 0xf7];
          return reply(pending);
        }
        const f = cur ? files[cur] : new Uint8Array();
        const block = f.slice(pos, pos + chunk);
        pos += block.length;
        const packed = block.length ? pack(block) : [];
        const c = crc32(block);
        const x = (c ^ 0xffffffff) >>> 0;
        const sum = [x & 0x7f, (x >>> 7) & 0x7f, (x >>> 14) & 0x7f, (x >>> 21) & 0x7f, (x >>> 28) & 0x0f];
        pending = block.length
          ? [0xf0, 0x52, 0, 0x61, 0x60, 0x04, 0x22, 0, 0, block.length & 0x7f, block.length >> 7, ...packed, ...sum, 0xf7]
          : [0xf0, 0x52, 0, 0x61, 0x60, 0x04, 0x22, 0, 0, 0, 0, ...sum, 0xf7];
        return reply([0xf0, 0x52, 0, 0x61, 0x60, 0x04, 0x22, 0xf7]);
      }
      return reply([0xf0, 0x52, 0, 0x61, 0x60, 0x04, cmd, 0xf7]);
    },
  };
  let pending: number[] | null = null;
  return { svc: new WebMidiService({ zoomOut, zoomIn, zoomModelId: 0x61 }), sent };
}

const payload = (n: number, seed: number) => new Uint8Array(Array.from({ length: n }, (_, i) => (i * 31 + seed) & 0xff));

describe('file list / download against a mock pedal', () => {
  const files = { 'SCENE.ZDL': payload(333, 1), 'TS_DRIVE.ZDL': payload(250, 9), 'BIG.ZDL': payload(1000, 5) };

  it('lists all files with sizes', async () => {
    const { svc } = makeFileDevice(files, 'lsbFirst');
    const res = await svc.listDeviceFiles(() => {});
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.files).toEqual([
      { name: 'SCENE.ZDL', size: 333 },
      { name: 'TS_DRIVE.ZDL', size: 250 },
      { name: 'BIG.ZDL', size: 1000 },
    ]);
  });

  for (const order of ['lsbFirst', 'msbFirst'] as const) {
    it(`downloads a multi-chunk file byte-exact (${order}) and closes it`, async () => {
      const { svc, sent } = makeFileDevice(files, order);
      const res = await svc.downloadDeviceFile('BIG.ZDL', () => {}, 1000);
      if (!res.ok) throw new Error(res.userMessage);
      expect(res.ok).toBe(true);
      if (res.ok) expect(Array.from(res.data)).toEqual(Array.from(files['BIG.ZDL']));
      const cmds = sent.filter((m) => m[4] === 0x60).map((m) => m[5]);
      expect(cmds).toContain(0x09);
      for (const m of sent) if (m[1] === 0x52) expect([0x28, 0x31, 0x32, 0x24, 0x23]).not.toContain(m[4] === 0x60 ? m[5] : m[4]);
      const open = sent.find((m) => m[4] === 0x60 && m[5] === 0x20)!;
      expect(open.slice(7, 16)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0]);
      expect(open[16]).toBe('B'.charCodeAt(0));
    });
  }

  it('downloads everything into a zip and fails cleanly on a size mismatch', async () => {
    const { svc } = makeFileDevice(files, 'lsbFirst');
    const list = await svc.listDeviceFiles(() => {});
    if (!list.ok) throw new Error('list failed');
    const all = await svc.downloadAllDeviceFiles(list.files, () => {});
    expect(all.ok).toBe(true);
    if (all.ok) expect(all.zip.length).toBeGreaterThan(333 + 250 + 1000);
    const bad = await svc.downloadAllDeviceFiles([{ name: 'SCENE.ZDL', size: 999 }], () => {});
    expect(bad.ok).toBe(false);
  }, 20000);

  it('unpack7 handles a short final group', () => {
    expect(Array.from(unpack7(new Uint8Array([0, 1, 2, 3]), 'lsbFirst', 3))).toEqual([1, 2, 3]);
  });
});

describe('download failure diagnostics', () => {
  it('returns a request/reply trace when the pedal does not answer the open', async () => {
    const zoomIn: any = { name: 'ZOOM MS Series', onmidimessage: null };
    const zoomOut: any = { name: 'ZOOM MS Series', send: () => {} };
    const svc = new WebMidiService({ zoomOut, zoomIn, zoomModelId: 0x61 });
    const orig = (svc as any).zoomRequest.bind(svc);
    (svc as any).zoomRequest = (body: number[]) => orig(body, 10);
    const res = await svc.downloadDeviceFile('X.ZDL', () => {}, 5);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.trace).toMatch(/-> f0 52 00 61 60 25/);
      expect(res.trace).toMatch(/\(no reply\)/);
    }
  });
});

describe('name encoding and buffer address as seen on a real MS-50G', () => {
  const files = { 'NOISEGTE.ZDL': payload(777, 3) };
  it('finds the file with a plain ASCII name and reads it', async () => {
    const { svc, sent } = makeFileDevice(files, 'lsbFirst', 100, { plainOnly: true });
    const res = await svc.downloadDeviceFile('NOISEGTE.ZDL', () => {}, 777);
    if (!res.ok) throw new Error(res.userMessage + '\n' + res.trace);
    expect(Array.from(res.data)).toEqual(Array.from(files['NOISEGTE.ZDL']));
    const check = sent.find((m) => m[4] === 0x60 && m[5] === 0x25)!;
    expect(check.slice(8, 14)).toEqual(Array.from('NOISEG').map((c) => c.charCodeAt(0)));
  });
  it('uses the buffer address returned by the open reply', async () => {
    const { svc, sent } = makeFileDevice(files, 'msbFirst', 100, { plainOnly: true, needAddr: true });
    const res = await svc.downloadDeviceFile('NOISEGTE.ZDL', () => {}, 777);
    if (!res.ok) throw new Error(res.userMessage + '\n' + res.trace);
    expect(res.data.length).toBe(777);
    const chunkReq = sent.find((m) => m[4] === 0x60 && m[5] === 0x22)!;
    expect(chunkReq.slice(6, 11)).toEqual([0x74, 0x6f, 0x40, 0x0f, 0x01]);
  });
  it('reports a clear failure when the pedal cannot find the file', async () => {
    const { svc } = makeFileDevice(files, 'lsbFirst', 100, { plainOnly: true });
    const res = await svc.downloadDeviceFile('NOPE.ZDL', () => {}, 5);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.userMessage).toMatch(/did not find the file/);
  });
});
