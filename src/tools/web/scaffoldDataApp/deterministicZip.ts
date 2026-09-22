/**
 * Minimal, dependency-free ZIP writer used at request time by
 * `dataAppWorkspaceStore.ts`'s `createS3Workspace` to build a byte-stable
 * archive of a finalized data app workspace's in-memory entries for S3 delivery.
 *
 * Entries are DEFLATE'd at a fixed compression level, sorted by path, and
 * written with a fixed DOS timestamp and no extra fields, so identical inputs
 * always produce byte-identical output (for a given Node/zlib version).
 * Directory entries are omitted; unzippers create the directories implied by
 * each file path.
 */

import { deflateRawSync } from 'node:zlib';

const CRC_TABLE = ((): Uint32Array => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i++) {
    crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export interface ZipEntry {
  /** POSIX path within the archive. */
  path: string;
  data: Buffer;
}

// 1980-01-01 00:00:00, the ZIP epoch, encoded as DOS date/time.
const DOS_DATE = 0x0021;
const DOS_TIME = 0x0000;

const LOCAL_HEADER_SIG = 0x04034b50;
const CENTRAL_HEADER_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;
const VERSION = 20;
const COMPRESSION_METHOD_DEFLATE = 8;

// Best compression: this runs once per scaffold call on small-to-moderate
// in-memory content (a few MB at most), so the extra CPU over a lower level
// is negligible against the S3 upload/download time it saves.
const DEFLATE_OPTIONS = { level: 9 };

/**
 * Builds a DEFLATE-method ZIP archive from the given entries. Entries are
 * sorted by path so output is deterministic regardless of input order.
 */
export function buildZip(entries: ZipEntry[]): Buffer {
  const sorted = [...entries].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of sorted) {
    const nameBuf = Buffer.from(entry.path, 'utf8');
    const crc = crc32(entry.data);
    const uncompressedSize = entry.data.length;
    const compressed = deflateRawSync(entry.data, DEFLATE_OPTIONS);
    const compressedSize = compressed.length;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL_HEADER_SIG, 0);
    local.writeUInt16LE(VERSION, 4);
    local.writeUInt16LE(0, 6); // general purpose flags
    local.writeUInt16LE(COMPRESSION_METHOD_DEFLATE, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressedSize, 18);
    local.writeUInt32LE(uncompressedSize, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28); // extra field length
    localParts.push(local, nameBuf, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(CENTRAL_HEADER_SIG, 0);
    central.writeUInt16LE(VERSION, 4); // version made by
    central.writeUInt16LE(VERSION, 6); // version needed
    central.writeUInt16LE(0, 8); // general purpose flags
    central.writeUInt16LE(COMPRESSION_METHOD_DEFLATE, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressedSize, 20);
    central.writeUInt32LE(uncompressedSize, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30); // extra field length
    central.writeUInt16LE(0, 32); // comment length
    central.writeUInt16LE(0, 34); // disk number start
    central.writeUInt16LE(0, 36); // internal attributes
    central.writeUInt32LE(0, 38); // external attributes
    central.writeUInt32LE(offset, 42); // local header offset
    centralParts.push(central, nameBuf);

    offset += local.length + nameBuf.length + compressed.length;
  }

  const localData = Buffer.concat(localParts);
  const centralDir = Buffer.concat(centralParts);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(EOCD_SIG, 0);
  eocd.writeUInt16LE(0, 4); // disk number
  eocd.writeUInt16LE(0, 6); // disk with central dir
  eocd.writeUInt16LE(sorted.length, 8); // records on this disk
  eocd.writeUInt16LE(sorted.length, 10); // total records
  eocd.writeUInt32LE(centralDir.length, 12);
  eocd.writeUInt32LE(localData.length, 16); // central dir offset
  eocd.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([localData, centralDir, eocd]);
}
