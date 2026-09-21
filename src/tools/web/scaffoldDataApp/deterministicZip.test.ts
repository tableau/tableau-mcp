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

  it('stores the file name and raw (uncompressed) bytes in the archive', () => {
    const zip = buildZip([entry('Data App Name/manifest.json', '{"id":"x"}')]);
    const text = zip.toString('latin1');
    expect(text).toContain('Data App Name/manifest.json');
    expect(text).toContain('{"id":"x"}');
  });
});
