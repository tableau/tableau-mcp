import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { uploadStreamToS3 } from '../s3Client.js';
import { buildWorkbookS3Key, uploadWorkbookToS3 } from './uploadWorkbookToS3.js';

vi.mock('../s3Client.js', async (importActual) => ({
  ...(await importActual<typeof import('../s3Client.js')>()),
  uploadStreamToS3: vi.fn().mockImplementation(async (stream) => {
    for await (const _chunk of stream) {
      // Consume the stream so the test exercises file-backed delivery.
    }
    return 'https://s3.example.com/signed-workbook';
  }),
}));

const temporaryDirectories: string[] = [];

afterEach(async () => {
  vi.clearAllMocks();
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('uploadWorkbookToS3', () => {
  it('streams a normalized TWB with download metadata', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'tableau-mcp-s3-workbook-test-'));
    temporaryDirectories.push(directory);
    const workbookFilePath = join(directory, 'Sales.twb');
    await writeFile(workbookFilePath, '<workbook />');

    const result = await uploadWorkbookToS3(
      {
        workbookFilePath,
        fileName: 'Sales.twb',
        fileType: 'twb',
        sourceFileType: 'twbx',
        sizeBytes: 12,
      },
      {
        workbookId: 'workbook-id',
        config: {
          bucket: 'tableau-artifacts',
          region: 'us-east-1',
          keyPrefix: 'workbook-downloads/',
          presignTtlSeconds: 300,
        },
      },
    );

    expect(result).toEqual({
      url: 'https://s3.example.com/signed-workbook',
      fileName: 'Sales.twb',
      fileType: 'twb',
      sourceFileType: 'twbx',
      sizeBytes: 12,
    });
    expect(uploadStreamToS3).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        bucket: 'tableau-artifacts',
        key: expect.stringMatching(/^workbook-downloads\/workbook-id\/[0-9a-f-]+\.twb$/),
        contentType: 'application/xml',
        contentDisposition: 'attachment; filename="Sales.twb"',
        contentLength: 12,
      }),
    );
  });
});

describe('buildWorkbookS3Key', () => {
  it('normalizes the prefix and workbook id', () => {
    expect(buildWorkbookS3Key('/downloads', '../workbook/id', () => 'uuid')).toBe(
      'downloads/___workbook_id/uuid.twb',
    );
  });
});
