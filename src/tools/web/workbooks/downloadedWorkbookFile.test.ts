import { mkdtemp, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { Readable } from 'stream';
import { afterEach, describe, expect, it } from 'vitest';

import { exportedForTesting, persistDownloadedWorkbook } from './downloadedWorkbookFile.js';

const temporaryDirectories: string[] = [];
const { getContentDispositionFileName, getWorkbookFileType, getSafeFileName } = exportedForTesting;

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, {
        recursive: true,
        force: true,
      }),
    ),
  );
});

describe('persistDownloadedWorkbook', () => {
  it('streams a TWB into a private temporary file and returns its metadata', async () => {
    const temporaryDirectory = await createTemporaryDirectory();
    const bytes = Buffer.from('<workbook />');

    const result = await persistDownloadedWorkbook(
      {
        content: Readable.from(bytes),
        contentDisposition: 'name="tableau_workbook"; filename="Sales Workbook.twb"',
        contentType: 'application/xml',
      },
      { temporaryDirectory },
    );

    expect(result.fileName).toBe('Sales Workbook.twb');
    expect(result.fileType).toBe('twb');
    expect(result.sizeBytes).toBe(bytes.byteLength);
    expect(dirname(result.workbookFilePath)).toContain('tableau-mcp-workbook-');
    await expect(readFile(result.workbookFilePath)).resolves.toEqual(bytes);
  });

  it('does not allow a response filename to escape the temporary directory', async () => {
    const temporaryDirectory = await createTemporaryDirectory();

    const result = await persistDownloadedWorkbook(
      {
        content: Readable.from(Buffer.from('package')),
        contentDisposition: 'filename="../../Private Workbook.twbx"',
        contentType: 'application/octet-stream',
      },
      { temporaryDirectory },
    );

    expect(result.fileName).toBe('Private Workbook.twbx');
    expect(result.fileType).toBe('twbx');
    expect(result.workbookFilePath.startsWith(temporaryDirectory)).toBe(true);
  });

  it('uses the content type and a generated name when no filename is returned', async () => {
    const temporaryDirectory = await createTemporaryDirectory();

    const result = await persistDownloadedWorkbook(
      {
        content: Readable.from(Buffer.from('<workbook />')),
        contentType: 'application/xml; charset=utf-8',
      },
      { temporaryDirectory, generateUuid: () => 'generated-id' },
    );

    expect(result.fileName).toBe('generated-id.twb');
    expect(result.fileType).toBe('twb');
  });
});

describe('downloaded workbook filename handling', () => {
  it('parses RFC 5987 encoded filenames', () => {
    expect(getContentDispositionFileName("attachment; filename*=UTF-8''Sales%20Workbook.twb")).toBe(
      'Sales Workbook.twb',
    );
  });

  it('falls back to TWBX for an unknown binary response', () => {
    expect(getWorkbookFileType(undefined, 'application/octet-stream')).toBe('twbx');
  });

  it('replaces an unsafe filename with a generated filename', () => {
    expect(getSafeFileName('..hidden.twb', 'twb', () => 'generated-id')).toBe('generated-id.twb');
  });
});

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'tableau-mcp-download-test-'));
  temporaryDirectories.push(directory);
  return directory;
}
