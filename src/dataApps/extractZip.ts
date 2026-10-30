/**
 * Extracts a zip using the central directory. Archiver sets the data-descriptor
 * flag, so local-header sizes are zero and the real sizes live in the central
 * directory.
 */

import { mkdir, readFile, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { crc32, inflateRawSync } from 'zlib';

import { containedPath } from './packageFiles.js';

type ZipEntry = {
  name: string;
  method: number;
  crc: number;
  compressedSize: number;
  uncompressedSize: number;
  localOffset: number;
  symlink: boolean;
};

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const UNIX_HOST = 3;
const SYMLINK_MODE = 0o120000;
const FILE_TYPE_MASK = 0o170000;

function findEocd(buf: Buffer): number {
  const min = Math.max(0, buf.length - 22 - 65535);
  for (let offset = buf.length - 22; offset >= min; offset--) {
    if (buf.readUInt32LE(offset) === EOCD_SIGNATURE) {
      return offset;
    }
  }
  throw new Error('ZIP end of central directory not found');
}

function readCentralDirectory(buf: Buffer): ZipEntry[] {
  const eocd = findEocd(buf);
  const entryCount = buf.readUInt16LE(eocd + 10);
  const directoryOffset = buf.readUInt32LE(eocd + 16);
  if (directoryOffset === 0xffffffff) {
    throw new Error('ZIP64 archives are not supported');
  }
  const entries: ZipEntry[] = [];
  let offset = directoryOffset;
  for (let index = 0; index < entryCount; index++) {
    if (buf.readUInt32LE(offset) !== CENTRAL_SIGNATURE) {
      throw new Error('ZIP central directory is truncated');
    }
    const hostOs = buf.readUInt16LE(offset + 4) >> 8;
    const method = buf.readUInt16LE(offset + 10);
    const crc = buf.readUInt32LE(offset + 16);
    const compressedSize = buf.readUInt32LE(offset + 20);
    const uncompressedSize = buf.readUInt32LE(offset + 24);
    const nameLength = buf.readUInt16LE(offset + 28);
    const extraLength = buf.readUInt16LE(offset + 30);
    const commentLength = buf.readUInt16LE(offset + 32);
    const externalAttr = buf.readUInt32LE(offset + 38);
    const localOffset = buf.readUInt32LE(offset + 42);
    const name = buf.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
    const unixMode = externalAttr >>> 16;
    const symlink = hostOs === UNIX_HOST && (unixMode & FILE_TYPE_MASK) === SYMLINK_MODE;
    entries.push({
      name,
      method,
      crc,
      compressedSize,
      uncompressedSize,
      localOffset,
      symlink,
    });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function safeEntryPath(root: string, name: string): string {
  const normalized = name.split('\\').join('/');
  if (normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized)) {
    throw new Error(`Refusing an absolute zip entry: ${name}`);
  }
  const parts = normalized.split('/').filter((part) => part.length > 0);
  return containedPath(root, join(root, ...parts));
}

function entryBytes(buf: Buffer, entry: ZipEntry): Buffer {
  if (buf.readUInt32LE(entry.localOffset) !== LOCAL_SIGNATURE) {
    throw new Error(`ZIP local header missing for ${entry.name}`);
  }
  const nameLength = buf.readUInt16LE(entry.localOffset + 26);
  const extraLength = buf.readUInt16LE(entry.localOffset + 28);
  const start = entry.localOffset + 30 + nameLength + extraLength;
  const end = start + entry.compressedSize;
  if (end > buf.length) {
    throw new Error(`ZIP entry is truncated: ${entry.name}`);
  }
  const compressed = buf.subarray(start, end);
  const data =
    entry.method === 0
      ? Buffer.from(compressed)
      : entry.method === 8
        ? inflateRawSync(compressed)
        : null;
  if (!data) {
    throw new Error(`Unsupported ZIP compression method ${entry.method} for ${entry.name}`);
  }
  if (data.length !== entry.uncompressedSize || crc32(data) >>> 0 !== entry.crc) {
    throw new Error(`ZIP entry failed integrity check: ${entry.name}`);
  }
  return data;
}

export async function extractZip(zipPath: string, destDir: string): Promise<void> {
  const buf = await readFile(zipPath);
  for (const entry of readCentralDirectory(buf)) {
    if (entry.symlink) {
      throw new Error(`Refusing to extract a symlink: ${entry.name}`);
    }
    const destination = safeEntryPath(destDir, entry.name);
    if (entry.name.endsWith('/')) {
      await mkdir(destination, { recursive: true });
      continue;
    }
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, entryBytes(buf, entry), { flag: 'wx' });
  }
}
