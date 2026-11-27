/**
 * Helpers for the MS-50G's on-pedal file system (where installed .ZDL effects live).
 * Message layouts follow the Zoom file protocol (`0x60` command family) as used by the open-source zoom-zt2 tool and
 * confirmed against the file-list replies of a real MS-50G (OS ms70cdr 2.10): reply = F0 52 00 <id> 60 <status> ...,
 * status 4 = entry present, file name NUL-terminated from byte 15, file size as 7-bit little-endian groups from byte 30.
 */

let crcTable: Uint32Array | null = null;

export function crc32(data: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) crc = crcTable[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** Plain C-string form: ASCII characters followed by one 00 terminator. */
export function plainName(name: string): number[] {
  return [...Array.from(name).map((ch) => ch.charCodeAt(0) & 0x7f), 0x00];
}

/** Alternative form used by another Zoom model: each ASCII character followed by 00. */
export function interleaveName(name: string): number[] {
  const out: number[] = [];
  for (const ch of name) out.push(ch.charCodeAt(0) & 0x7f, 0x00);
  return out;
}

export interface DeviceFileEntry {
  name: string;
  size: number;
}

/** Parses a `60 25` / `60 26` reply. Returns null when the reply is not an entry (end of listing). */
export function parseFileListReply(msg: Uint8Array): DeviceFileEntry | null {
  if (msg.length < 16 || msg[0] !== 0xf0 || msg[4] !== 0x60 || msg[5] !== 0x04) return null;
  let name = '';
  for (let i = 15; i < Math.min(27, msg.length); i++) {
    if (msg[i] === 0x00) break;
    name += String.fromCharCode(msg[i]);
  }
  if (!name) return null;
  const g = (i: number) => (i < msg.length - 1 ? msg[i] & 0x7f : 0);
  const size = g(30) + g(31) * 128 + g(32) * 16384 + g(33) * 2097152;
  return { name, size };
}

/** Unpacks 8-byte groups (one high-bits byte + 7 data bytes). `order` is the bit order of the high-bits byte. */
export function unpack7(payload: Uint8Array, order: 'lsbFirst' | 'msbFirst', length: number): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < payload.length; i += 8) {
    const hdr = payload[i];
    for (let j = 0; j < 7 && i + 1 + j < payload.length; j++) {
      const bit = order === 'lsbFirst' ? (hdr >>> j) & 1 : (hdr >>> (6 - j)) & 1;
      out.push((payload[i + 1 + j] & 0x7f) | (bit << 7));
    }
  }
  return new Uint8Array(out.slice(0, length));
}

export type ChunkResult =
  | { kind: 'end' }
  | { kind: 'data'; block: Uint8Array }
  | { kind: 'error'; reason: string };

/** Decodes one file-read chunk reply and verifies its CRC32 (trying both high-bit orders). */
export function decodeChunkReply(msg: Uint8Array): ChunkResult {
  if (msg.length < 16 || msg[0] !== 0xf0 || msg[4] !== 0x60) return { kind: 'error', reason: 'not a file reply' };
  if (msg[5] !== 0x04) return { kind: 'end' };
  const length = msg[10] * 128 + msg[9];
  if (length === 0) return { kind: 'end' };
  const end = Math.min(11 + length + Math.floor(length / 7) + 1, msg.length - 6);
  const payload = msg.slice(11, end);
  const p = msg.slice(msg.length - 6, msg.length - 1);
  const checksum = (p[0] + p[1] * 128 + p[2] * 16384 + p[3] * 2097152 + (p[4] & 0x0f) * 268435456) >>> 0;
  for (const order of ['lsbFirst', 'msbFirst'] as const) {
    const block = unpack7(payload, order, length);
    if (block.length === length && ((checksum ^ 0xffffffff) >>> 0) === crc32(block)) return { kind: 'data', block };
  }
  return { kind: 'error', reason: 'checksum mismatch' };
}

/** Minimal "stored" (uncompressed) zip writer so all effect files can be saved as one download. */
export function buildZip(files: Array<{ name: string; data: Uint8Array }>): Uint8Array {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const u16 = (v: number) => [v & 0xff, (v >>> 8) & 0xff];
  const u32 = (v: number) => [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
  for (const f of files) {
    const nameBytes = enc.encode(f.name);
    const crc = crc32(f.data);
    const local = new Uint8Array([
      ...u32(0x04034b50), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0x21),
      ...u32(crc), ...u32(f.data.length), ...u32(f.data.length), ...u16(nameBytes.length), ...u16(0),
      ...nameBytes,
    ]);
    parts.push(local, f.data);
    central.push(
      new Uint8Array([
        ...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0x21),
        ...u32(crc), ...u32(f.data.length), ...u32(f.data.length), ...u16(nameBytes.length), ...u16(0), ...u16(0),
        ...u16(0), ...u16(0), ...u32(0), ...u32(offset), ...nameBytes,
      ])
    );
    offset += local.length + f.data.length;
  }
  const centralSize = central.reduce((n, c) => n + c.length, 0);
  const endRec = new Uint8Array([
    ...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length),
    ...u32(centralSize), ...u32(offset), ...u16(0),
  ]);
  const all = [...parts, ...central, endRec];
  const out = new Uint8Array(all.reduce((n, a) => n + a.length, 0));
  let o = 0;
  for (const a of all) {
    out.set(a, o);
    o += a.length;
  }
  return out;
}
