import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import { resolveLocalWorkbook } from './localWorkbookFile.js';

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

describe('resolveLocalWorkbook', () => {
  it('returns bounded bytes and preserves a safe TWB filename', async () => {
    const filePath = await createTempFile('BoltBikes Workbook.twb', '<workbook />');

    await expect(resolveLocalWorkbook(filePath)).resolves.toEqual({
      fileName: 'BoltBikes Workbook.twb',
      bytes: Buffer.from('<workbook />'),
    });
  });

  it('uses a UUID filename when the local filename is unsafe', async () => {
    const filePath = await createTempFile('unsafe<>name.twb', '<workbook />');

    await expect(
      resolveLocalWorkbook(filePath, { generateUuid: () => 'generated-id' }),
    ).resolves.toEqual({
      fileName: 'generated-id.twb',
      bytes: Buffer.from('<workbook />'),
    });
  });

  it('rejects relative paths', async () => {
    await expect(resolveLocalWorkbook('workbook.twb')).rejects.toThrow('must be absolute');
  });

  it('rejects files without a TWB extension', async () => {
    await expect(resolveLocalWorkbook('/tmp/workbook.xml')).rejects.toThrow('must end in .twb');
  });

  it('rejects directories even when their name ends in TWB', async () => {
    const directory = await createTempDirectory();
    const nestedDirectory = join(directory, 'folder.twb');
    await mkdir(nestedDirectory);

    await expect(resolveLocalWorkbook(nestedDirectory)).rejects.toThrow('regular file');
  });

  it('rejects a file larger than the configured limit', async () => {
    const filePath = await createTempFile('large.twb', Buffer.alloc(5));

    await expect(resolveLocalWorkbook(filePath, { maxBytes: 4 })).rejects.toThrow(
      'exceeds the 4-byte limit',
    );
  });

  it('does not expose a missing local path in its error', async () => {
    const missingPath = '/tmp/private/missing-workbook.twb';

    try {
      await resolveLocalWorkbook(missingPath);
      expect.fail('Expected the missing file read to fail');
    } catch (error) {
      expect(String(error)).toContain('Local workbook file could not be opened.');
      expect(String(error)).not.toContain(missingPath);
    }
  });
});

async function createTempDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'tableau-mcp-local-workbook-'));
  tempDirectories.push(directory);
  return directory;
}

async function createTempFile(fileName: string, contents: string | Buffer): Promise<string> {
  const directory = await createTempDirectory();
  const filePath = join(directory, fileName);
  await writeFile(filePath, contents);
  return filePath;
}
