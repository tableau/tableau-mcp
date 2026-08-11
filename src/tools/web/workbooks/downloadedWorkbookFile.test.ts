import { mkdtemp, readdir, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { Readable } from 'stream';
import { afterEach, describe, expect, it } from 'vitest';

import { exportedForTesting, persistDownloadedWorkbook } from './downloadedWorkbookFile.js';

const temporaryDirectories: string[] = [];
const { getContentDispositionFileName, getWorkbookFileType, getSafeTwbFileName } =
  exportedForTesting;

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
  it('streams a native TWB into a private temporary file', async () => {
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

    expect(result).toMatchObject({
      fileName: 'Sales Workbook.twb',
      fileType: 'twb',
      sourceFileType: 'twb',
      sizeBytes: bytes.byteLength,
    });
    expect(dirname(result.workbookFilePath)).toContain('tableau-mcp-workbook-');
    await expect(readFile(result.workbookFilePath)).resolves.toEqual(bytes);
  });

  it('streams a TWBX and retains only its embedded TWB', async () => {
    const temporaryDirectory = await createTemporaryDirectory();

    const result = await persistDownloadedWorkbook(
      {
        content: Readable.from(Buffer.from(TWBX_WITH_ONE_TWB_BASE64, 'base64')),
        contentDisposition: 'name="tableau_workbook"; filename="Sales Workbook.twbx"',
        contentType: 'application/octet-stream',
      },
      { temporaryDirectory },
    );

    expect(result).toMatchObject({
      fileName: 'Sales.twb',
      fileType: 'twb',
      sourceFileType: 'twbx',
    });
    await expect(readFile(result.workbookFilePath, 'utf8')).resolves.toContain('<workbook />');
  });

  it('does not allow a response filename to escape the temporary directory', async () => {
    const temporaryDirectory = await createTemporaryDirectory();

    const result = await persistDownloadedWorkbook(
      {
        content: Readable.from(Buffer.from('<workbook />')),
        contentDisposition: 'filename="../../Private Workbook.twb"',
        contentType: 'application/xml',
      },
      { temporaryDirectory },
    );

    expect(result.fileName).toBe('Private Workbook.twb');
    expect(result.workbookFilePath.startsWith(temporaryDirectory)).toBe(true);
  });

  it('rejects a TWBX containing multiple workbook definitions', async () => {
    const temporaryDirectory = await createTemporaryDirectory();

    await expect(
      persistDownloadedWorkbook(
        {
          content: Readable.from(Buffer.from(TWBX_WITH_MULTIPLE_TWBS_BASE64, 'base64')),
          contentDisposition: 'filename="Ambiguous.twbx"',
          contentType: 'application/octet-stream',
        },
        { temporaryDirectory },
      ),
    ).rejects.toThrow('multiple TWB files');
    await expect(readdir(temporaryDirectory)).resolves.toEqual([]);
  });

  it('rejects a TWBX with no workbook definition', async () => {
    const temporaryDirectory = await createTemporaryDirectory();

    await expect(
      persistDownloadedWorkbook(
        {
          content: Readable.from(Buffer.from(TWBX_WITHOUT_TWB_BASE64, 'base64')),
          contentDisposition: 'filename="Missing.twbx"',
          contentType: 'application/octet-stream',
        },
        { temporaryDirectory },
      ),
    ).rejects.toThrow('does not contain a TWB file');
  });
});

describe('downloaded workbook filename handling', () => {
  it('parses RFC 5987 encoded filenames', () => {
    expect(getContentDispositionFileName("attachment; filename*=UTF-8''Sales%20Workbook.twb")).toBe(
      'Sales Workbook.twb',
    );
  });

  it('detects TWBX for an unknown binary response', () => {
    expect(getWorkbookFileType(undefined, 'application/octet-stream')).toBe('twbx');
  });

  it('replaces an unsafe filename with a generated TWB filename', () => {
    expect(getSafeTwbFileName('..hidden.twb', () => 'generated-id')).toBe('generated-id.twb');
  });
});

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'tableau-mcp-download-test-'));
  temporaryDirectories.push(directory);
  return directory;
}

const TWBX_WITH_ONE_TWB_BASE64 =
  'UEsDBAoAAAAAAGKvCl1I3YgJNQAAADUAAAAJABwAU2FsZXMudHdiVVQJAAPngXpq6IF6anV4CwABBPUBAAAEAAAAADw/eG1sIHZlcnNpb249JzEuMCcgZW5jb2Rpbmc9J3V0Zi04JyA/Pgo8d29ya2Jvb2sgLz4KUEsDBAoAAAAAAGKvCl0AAAAAAAAAAAAAAAAFABwARGF0YS9VVAkAA+eBemrugXpqdXgLAAEE9QEAAAQAAAAAUEsDBAoAAAAAAGKvCl2TZDaLEgAAABIAAAAPABwARGF0YS9yZWFkbWUudHh0VVQJAAPngXpq6IF6anV4CwABBPUBAAAEAAAAAHBhY2thZ2VkIHJlc291cmNlClBLAQIeAwoAAAAAAGKvCl1I3YgJNQAAADUAAAAJABgAAAAAAAEAAACkgQAAAABTYWxlcy50d2JVVAUAA+eBemp1eAsAAQT1AQAABAAAAABQSwECHgMKAAAAAABirwpdAAAAAAAAAAAAAAAABQAYAAAAAAAAABAA7UF4AAAARGF0YS9VVAUAA+eBemp1eAsAAQT1AQAABAAAAABQSwECHgMKAAAAAABirwpdk2Q2ixIAAAASAAAADwAYAAAAAAABAAAApIG3AAAARGF0YS9yZWFkbWUudHh0VVQFAAPngXpqdXgLAAEE9QEAAAQAAAAAUEsFBgAAAAADAAMA7wAAABIBAAAAAA==';

const TWBX_WITH_MULTIPLE_TWBS_BASE64 =
  'UEsDBAoAAAAAAGuvCl2WboDnDQAAAA0AAAAJABwARmlyc3QudHdiVVQJAAP5gXpq+oF6anV4CwABBPUBAAAEAAAAADx3b3JrYm9vayAvPgpQSwMECgAAAAAAa68KXQAAAAAAAAAAAAAAAAcAHABuZXN0ZWQvVVQJAAP5gXpq/4F6anV4CwABBPUBAAAEAAAAAFBLAwQKAAAAAABrrwpdlm6A5w0AAAANAAAAEQAcAG5lc3RlZC9TZWNvbmQudHdiVVQJAAP5gXpq+oF6anV4CwABBPUBAAAEAAAAADx3b3JrYm9vayAvPgpQSwECHgMKAAAAAABrrwpdlm6A5w0AAAANAAAACQAYAAAAAAABAAAApIEAAAAARmlyc3QudHdiVVQFAAP5gXpqdXgLAAEE9QEAAAQAAAAAUEsBAh4DCgAAAAAAa68KXQAAAAAAAAAAAAAAAAcAGAAAAAAAAAAQAO1BUAAAAG5lc3RlZC9VVAUAA/mBemp1eAsAAQT1AQAABAAAAABQSwECHgMKAAAAAABrrwpdlm6A5w0AAAANAAAAEQAYAAAAAAABAAAApIGRAAAAbmVzdGVkL1NlY29uZC50d2JVVAUAA/mBemp1eAsAAQT1AQAABAAAAABQSwUGAAAAAAMAAwDzAAAA6QAAAAAA';

const TWBX_WITHOUT_TWB_BASE64 =
  'UEsDBAoAAAAAAHOvCl2GVmsCEQAAABEAAAAKABwAcmVhZG1lLnR4dFVUCQADCYJ6agqCemp1eAsAAQT1AQAABAAAAABubyB3b3JrYm9vayBoZXJlClBLAQIeAwoAAAAAAHOvCl2GVmsCEQAAABEAAAAKABgAAAAAAAEAAACkgQAAAAByZWFkbWUudHh0VVQFAAMJgnpqdXgLAAEE9QEAAAQAAAAAUEsFBgAAAAABAAEAUAAAAFUAAAAAAA==';
