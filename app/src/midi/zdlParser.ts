/**
 * Reads the metadata of a Zoom MS-series `.ZDL` effect file (as downloaded from the pedal).
 *
 * Layout, worked out from a real `NOISEGTE.ZDL` downloaded from an MS-50G (OS ms70cdr 2.10):
 *   0x04 'SIZE' ... 0x14 'INFO' 'ZOOM EFFECT DLL SYSTEM VER 1.00' ... 0x40: effect id (u32 LE, e.g. 0x01000060)
 *   0x4c ELF image; its data section holds 0x30-byte records: 'OnOff', then the effect name, then one record per knob.
 *   knob record: name[12], max (u32 @+0x0c), default (u32 @+0x10), max again (u32 @+0x14).
 * Only what is confirmed on that file is used; anything unrecognised makes the parser return null (never guess).
 */
export interface ZdlParam {
  name: string;
  min: number;
  max: number;
  defaultValue: number;
  /** All 12 words of the record, kept so unexplained fields can be studied later. */
  raw: number[];
}

export interface ZdlInfo {
  /** 28-bit effect id as stored in patches (category nibble + id). */
  fxid: number;
  /** Effect name as stored inside the file (e.g. 'NoiseGate'). */
  name: string;
  params: ZdlParam[];
  size: number;
}

const REC = 0x30;

function cstr(d: Uint8Array, off: number, max: number): string {
  let s = '';
  for (let i = off; i < Math.min(off + max, d.length); i++) {
    const c = d[i];
    if (c === 0) break;
    if (c < 0x20 && s.length > 0) break; // e.g. GEQ band labels end in 0x1f
    if (c < 0x20 || c > 0x7e) return '';
    s += String.fromCharCode(c);
  }
  return s;
}

export function parseZdl(d: Uint8Array): ZdlInfo | null {
  if (d.length < 0x100) return null;
  const tag = (o: number) => String.fromCharCode(d[o], d[o + 1], d[o + 2], d[o + 3]);
  if (tag(4) !== 'SIZE' || tag(0x14) !== 'INFO') return null;
  const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
  const fxid = dv.getUint32(0x40, true);
  if (fxid === 0 || fxid > 0x0fffffff) return null;

  // locate the 'OnOff' record
  const needle = [0x4f, 0x6e, 0x4f, 0x66, 0x66, 0x00];
  let onoff = -1;
  for (let i = 0x100; i + needle.length < d.length; i++) {
    if (needle.every((b, k) => d[i + k] === b)) {
      onoff = i;
      break;
    }
  }
  if (onoff < 0) return null;
  const name = cstr(d, onoff + REC, 12);
  if (!name) return null;

  const params: ZdlParam[] = [];
  for (let o = onoff + 2 * REC; o + REC <= d.length && params.length < 12; o += REC) {
    const pn = cstr(d, o, 12);
    if (!pn) break;
    const raw = Array.from({ length: 12 }, (_, k) => dv.getUint32(o + k * 4, true));
    const max = raw[3];
    if (max > 0xffff || raw[4] > max) return null;
    params.push({ name: pn, min: 0, max, defaultValue: raw[4], raw });
  }
  return { fxid, name, params, size: d.length };
}
