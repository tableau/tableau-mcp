import { createHash } from 'crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { findExpectedSha256, verifyNodeArchive } from './seaNodeChecksum.js';

describe('Node archive checksum', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sea-checksum-'));
  const archive = join(dir, 'node-v1.0.0-linux-x64.tar.gz');
  const bytes = Buffer.from('pretend node archive');
  const digest = createHash('sha256').update(bytes).digest('hex');
  const name = 'node-v1.0.0-linux-x64.tar.gz';

  beforeAll(() => writeFileSync(archive, bytes));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('accepts an archive whose digest matches its SHASUMS256.txt line', async () => {
    const shasums = `${'0'.repeat(64)}  other.zip\n${digest}  ${name}\n`;
    expect(findExpectedSha256(shasums, name)).toBe(digest);
    await expect(verifyNodeArchive(archive, name, shasums)).resolves.toBeUndefined();
  });

  it('rejects a mismatched archive', async () => {
    const shasums = `${'a'.repeat(64)}  ${name}\n`;
    await expect(verifyNodeArchive(archive, name, shasums)).rejects.toThrow(/SHA-256 mismatch/);
  });

  it('rejects when SHASUMS256.txt has no line for the archive', async () => {
    const shasums = `${digest}  ${name}.other\n`;
    await expect(verifyNodeArchive(archive, name, shasums)).rejects.toThrow(/no entry/);
  });
});
