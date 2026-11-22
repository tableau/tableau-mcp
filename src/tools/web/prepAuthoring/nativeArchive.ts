import { deflateRawSync, inflateRawSync } from 'node:zlib';

import { AuthoringError, entryName, MAX_ENTRIES, MAX_FILE, MAX_TOTAL } from './projectIo.js';

const table = Uint32Array.from({ length: 256 }, (_, n) => {
  for (let i = 0; i < 8; i++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
export function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) crc = table[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function bounded64(data: Buffer, offset: number, maximum: number): number {
  if (offset < 0 || offset + 8 > data.length) throw new AuthoringError();
  const value = data.readBigUInt64LE(offset);
  if (value > BigInt(maximum)) throw new AuthoringError();
  return Number(value);
}
function zip64Extra(data: Buffer, offset: number, size: number): Buffer {
  const end = offset + size;
  if (end > data.length) throw new AuthoringError();
  let result: Buffer = Buffer.alloc(0);
  let found = false;
  while (offset < end) {
    if (offset + 4 > end) throw new AuthoringError();
    const tag = data.readUInt16LE(offset),
      length = data.readUInt16LE(offset + 2);
    offset += 4;
    if (offset + length > end) throw new AuthoringError();
    if (tag === 1) {
      if (found) throw new AuthoringError();
      found = true;
      result = data.subarray(offset, offset + length);
    }
    offset += length;
  }
  return result;
}
export function readNativeArchive(data: Buffer): Map<string, Buffer> {
  if (data.length > MAX_FILE || data.length < 22) throw new AuthoringError();
  let end = data.length - 22;
  for (; end >= Math.max(0, data.length - 65557); end--)
    if (
      data.readUInt32LE(end) === 0x06054b50 &&
      end + 22 + data.readUInt16LE(end + 20) === data.length
    )
      break;
  if (end < 0 || data.readUInt32LE(end) !== 0x06054b50) throw new AuthoringError();
  let count = data.readUInt16LE(end + 10),
    centralSize = data.readUInt32LE(end + 12),
    centralOffset = data.readUInt32LE(end + 16),
    centralEnd = end;
  if (data.readUInt32LE(end + 4) !== 0) throw new AuthoringError();
  if (end >= 20 && data.readUInt32LE(end - 20) === 0x07064b50) {
    const locator = end - 20,
      record = bounded64(data, locator + 8, MAX_FILE);
    if (
      data.readUInt32LE(locator + 4) !== 0 ||
      data.readUInt32LE(locator + 16) !== 1 ||
      record + 56 > locator ||
      data.readUInt32LE(record) !== 0x06064b50 ||
      record + 12 + bounded64(data, record + 4, MAX_FILE) !== locator ||
      data.readUInt32LE(record + 16) ||
      data.readUInt32LE(record + 20)
    )
      throw new AuthoringError();
    count = bounded64(data, record + 32, MAX_ENTRIES);
    if (bounded64(data, record + 24, MAX_ENTRIES) !== count) throw new AuthoringError();
    centralSize = bounded64(data, record + 40, MAX_FILE);
    centralOffset = bounded64(data, record + 48, MAX_FILE);
    centralEnd = record;
    if (
      (data.readUInt16LE(end + 10) !== 0xffff && data.readUInt16LE(end + 10) !== count) ||
      (data.readUInt32LE(end + 12) !== 0xffffffff && data.readUInt32LE(end + 12) !== centralSize) ||
      (data.readUInt32LE(end + 16) !== 0xffffffff && data.readUInt32LE(end + 16) !== centralOffset)
    )
      throw new AuthoringError();
  } else if (
    data.readUInt16LE(end + 8) !== count ||
    count === 0xffff ||
    centralSize === 0xffffffff ||
    centralOffset === 0xffffffff
  )
    throw new AuthoringError();
  if (!count || count > MAX_ENTRIES || centralOffset + centralSize !== centralEnd)
    throw new AuthoringError();
  const entries = new Map<string, Buffer>(),
    names = new Set<string>();
  const ranges: [number, number][] = [];
  let offset = centralOffset,
    total = 0;
  for (let i = 0; i < count; i++) {
    if (offset + 46 > centralEnd || data.readUInt32LE(offset) !== 0x02014b50)
      throw new AuthoringError();
    const flags = data.readUInt16LE(offset + 8),
      method = data.readUInt16LE(offset + 10),
      crc = data.readUInt32LE(offset + 16);
    let compressed = data.readUInt32LE(offset + 20),
      size = data.readUInt32LE(offset + 24),
      local = data.readUInt32LE(offset + 42);
    const nameLength = data.readUInt16LE(offset + 28),
      extra = data.readUInt16LE(offset + 30),
      comment = data.readUInt16LE(offset + 32);
    if (offset + 46 + nameLength + extra + comment > centralEnd) throw new AuthoringError();
    const extended = zip64Extra(data, offset + 46 + nameLength, extra);
    let cursor = 0;
    if (size === 0xffffffff) {
      size = bounded64(extended, cursor, MAX_TOTAL);
      cursor += 8;
    }
    if (compressed === 0xffffffff) {
      compressed = bounded64(extended, cursor, MAX_FILE);
      cursor += 8;
    }
    if (local === 0xffffffff) {
      local = bounded64(extended, cursor, MAX_FILE);
      cursor += 8;
    }
    const disk = data.readUInt16LE(offset + 34);
    if (
      (disk && disk !== 0xffff) ||
      (disk === 0xffff && (cursor + 4 > extended.length || extended.readUInt32LE(cursor)))
    )
      throw new AuthoringError();
    if (
      flags & ~(0x800 | 8 | 2 | 4) ||
      ![0, 8].includes(method) ||
      ((data.readUInt32LE(offset + 38) >>> 16) & 0xf000) === 0xa000 ||
      local + 30 > centralOffset
    )
      throw new AuthoringError();
    const nameBytes = data.subarray(offset + 46, offset + 46 + nameLength);
    // Tableau writes UTF-8. CP437 is supported for ZIPs without the UTF-8 flag.
    const name =
      flags & 0x800
        ? new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(nameBytes)
        : decodeCp437(nameBytes);
    const directory = name.endsWith('/');
    entryName(directory ? name.slice(0, -1) : name);
    if (names.has(name.toUpperCase().toLowerCase())) throw new AuthoringError();
    names.add(name.toUpperCase().toLowerCase());
    if (
      data.readUInt32LE(local) !== 0x04034b50 ||
      data.readUInt16LE(local + 6) !== flags ||
      data.readUInt16LE(local + 8) !== method ||
      data.readUInt16LE(local + 26) !== nameLength
    )
      throw new AuthoringError();
    const start = local + 30 + nameLength + data.readUInt16LE(local + 28);
    if (
      start + compressed > centralOffset ||
      !data.subarray(local + 30, local + 30 + nameLength).equals(nameBytes)
    )
      throw new AuthoringError();
    if (!(flags & 8)) {
      let localSize = data.readUInt32LE(local + 22),
        localCompressed = data.readUInt32LE(local + 18),
        cursor = 0;
      const extra = zip64Extra(data, local + 30 + nameLength, data.readUInt16LE(local + 28));
      if (localSize === 0xffffffff) {
        localSize = bounded64(extra, cursor, MAX_TOTAL);
        cursor += 8;
      }
      if (localCompressed === 0xffffffff) localCompressed = bounded64(extra, cursor, MAX_FILE);
      if (
        data.readUInt32LE(local + 14) !== crc ||
        localCompressed !== compressed ||
        localSize !== size
      )
        throw new AuthoringError();
    }
    ranges.push([local, start + compressed]);
    if (size > MAX_TOTAL - total) throw new AuthoringError();
    const payload = data.subarray(start, start + compressed);
    const decoded =
      method === 0
        ? Buffer.from(payload)
        : inflateRawSync(payload, { maxOutputLength: Math.max(1, size) });
    if (decoded.length !== size || crc32(decoded) !== crc) throw new AuthoringError();
    total += size;
    if (!directory) entries.set(name, decoded);
    offset += 46 + nameLength + extra + comment;
  }
  ranges.sort((a, b) => a[0] - b[0]);
  if (
    offset !== centralEnd ||
    ranges.some((range, i) => i > 0 && range[0] < ranges[i - 1][1]) ||
    !entries.has('flow')
  )
    throw new AuthoringError();
  return entries;
}
export function writeNativeArchive(entries: Map<string, Buffer>): Buffer {
  if (entries.size > MAX_ENTRIES) throw new AuthoringError();
  const bodies: Buffer[] = [],
    central: Buffer[] = [];
  let offset = 0,
    total = 0;
  const names = new Set<string>();
  for (const name of [...entries.keys()].sort()) {
    entryName(name);
    if (names.has(name.toUpperCase().toLowerCase())) throw new AuthoringError();
    names.add(name.toUpperCase().toLowerCase());
    const raw = entries.get(name)!;
    total += raw.length;
    if (total > MAX_TOTAL) throw new AuthoringError();
    const compressed = deflateRawSync(raw, { level: 9 }),
      encoded = Buffer.from(name),
      crc = crc32(raw);
    if (encoded.length > 65535) throw new AuthoringError();
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x800, 6);
    header.writeUInt16LE(8, 8);
    header.writeUInt16LE(0x5c21, 12);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(compressed.length, 18);
    header.writeUInt32LE(raw.length, 22);
    header.writeUInt16LE(encoded.length, 26);
    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50);
    record.writeUInt16LE(20, 4);
    header.copy(record, 6, 4, 28);
    record.writeUInt32LE(0x81a40000, 38);
    record.writeUInt32LE(offset, 42);
    bodies.push(header, encoded, compressed);
    central.push(record, encoded);
    offset += header.length + encoded.length + compressed.length;
    if (offset > MAX_FILE) throw new AuthoringError();
  }
  const directory = Buffer.concat(central),
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.size, 8);
  end.writeUInt16LE(entries.size, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  const result = Buffer.concat([...bodies, directory, end]);
  if (result.length > MAX_FILE) throw new AuthoringError();
  const actual = readNativeArchive(result);
  if (
    actual.size !== entries.size ||
    [...entries].some(([name, bytes]) => !bytes.equals(actual.get(name) ?? Buffer.alloc(0)))
  )
    throw new AuthoringError();
  return result;
}

const cp437 =
  '\u00c7\u00fc\u00e9\u00e2\u00e4\u00e0\u00e5\u00e7\u00ea\u00eb\u00e8\u00ef\u00ee\u00ec\u00c4\u00c5\u00c9\u00e6\u00c6\u00f4\u00f6\u00f2\u00fb\u00f9\u00ff\u00d6\u00dc\u00a2\u00a3\u00a5\u20a7\u0192\u00e1\u00ed\u00f3\u00fa\u00f1\u00d1\u00aa\u00ba\u00bf\u2310\u00ac\u00bd\u00bc\u00a1\u00ab\u00bb\u2591\u2592\u2593\u2502\u2524\u2561\u2562\u2556\u2555\u2563\u2551\u2557\u255d\u255c\u255b\u2510\u2514\u2534\u252c\u251c\u2500\u253c\u255e\u255f\u255a\u2554\u2569\u2566\u2560\u2550\u256c\u2567\u2568\u2564\u2565\u2559\u2558\u2552\u2553\u256b\u256a\u2518\u250c\u2588\u2584\u258c\u2590\u2580\u03b1\u00df\u0393\u03c0\u03a3\u03c3\u00b5\u03c4\u03a6\u0398\u03a9\u03b4\u221e\u03c6\u03b5\u2229\u2261\u00b1\u2265\u2264\u2320\u2321\u00f7\u2248\u00b0\u2219\u00b7\u221a\u207f\u00b2\u25a0\u00a0';
function decodeCp437(bytes: Buffer): string {
  return Array.from(bytes, (b) => (b < 128 ? String.fromCharCode(b) : cp437[b - 128])).join('');
}
