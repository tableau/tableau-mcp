import { inflateRawSync } from 'node:zlib';

import { buildZip, ZipEntry } from './deterministicZip.js';

const entry = (path: string, data: string): ZipEntry => ({ path, data: Buffer.from(data, 'utf8') });

const EOCD_SIG = 0x06054b50;

/** Reads the "total records" count from the End Of Central Directory record. */
function eocdEntryCount(zip: Buffer): number {
  // The EOCD has no comment here, so it is the final 22 bytes.
  const eocd = zip.subarray(zip.length - 22);
  expect(eocd.readUInt32LE(0)).toBe(EOCD_SIG);
  return eocd.readUInt16LE(10);
}

describe('buildZip', () => {
  it('produces byte-identical output for identical inputs', () => {
    const a = buildZip([entry('b.txt', 'two'), entry('a.txt', 'one')]);
    const b = buildZip([entry('b.txt', 'two'), entry('a.txt', 'one')]);
    expect(a.equals(b)).toBe(true);
  });

  it('is independent of input order (entries are sorted by path)', () => {
    const forward = buildZip([entry('a.txt', 'one'), entry('b.txt', 'two')]);
    const reversed = buildZip([entry('b.txt', 'two'), entry('a.txt', 'one')]);
    expect(forward.equals(reversed)).toBe(true);
  });

  it('starts with the local file header signature (PK\\x03\\x04)', () => {
    const zip = buildZip([entry('a.txt', 'one')]);
    expect(zip.readUInt32LE(0)).toBe(0x04034b50);
  });

  it('records the entry count in the EOCD', () => {
    expect(eocdEntryCount(buildZip([entry('a.txt', 'x'), entry('b.txt', 'y')]))).toBe(2);
    expect(eocdEntryCount(buildZip([entry('only.txt', 'z')]))).toBe(1);
  });

  it('changes bytes when file contents change', () => {
    const one = buildZip([entry('a.txt', 'one')]);
    const two = buildZip([entry('a.txt', 'two')]);
    expect(one.equals(two)).toBe(false);
  });

  it('stores the file name in cleartext and the DEFLATE-compressed bytes recover the original content', () => {
    const name = 'Data App Name/data-app.trex';
    const content = '{"id":"x"}';
    const zip = buildZip([entry(name, content)]);

    expect(zip.toString('latin1')).toContain(name);

    const nameLen = zip.readUInt16LE(26);
    const compressedSize = zip.readUInt32LE(18);
    const dataStart = 30 + nameLen;
    const compressed = zip.subarray(dataStart, dataStart + compressedSize);
    expect(inflateRawSync(compressed).toString('utf8')).toBe(content);
  });

  it('compresses a large, repetitive payload to a fraction of its uncompressed size', () => {
    // Sized comparably to the real vendored Extensions API library (~2.1MB) that
    // motivated switching from STORE to DEFLATE, so a regression to STORE (or an
    // accidental no-op) is caught here rather than only by manual verification.
    const large = 'The quick brown fox jumps over the lazy dog. '.repeat(50_000);
    const zip = buildZip([entry('big.txt', large)]);

    expect(zip.length).toBeLessThan(large.length / 50);

    const nameLen = zip.readUInt16LE(26);
    const compressedSize = zip.readUInt32LE(18);
    const uncompressedSize = zip.readUInt32LE(22);
    const dataStart = 30 + nameLen;
    const compressed = zip.subarray(dataStart, dataStart + compressedSize);
    expect(uncompressedSize).toBe(Buffer.byteLength(large));
    expect(inflateRawSync(compressed).toString('utf8')).toBe(large);
  });
});
