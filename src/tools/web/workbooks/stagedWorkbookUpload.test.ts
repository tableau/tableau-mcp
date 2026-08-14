import { BucketS3Config } from '../s3Client.js';
import {
  buildWorkbookUploadS3Key,
  MAX_STAGED_WORKBOOK_BYTES,
  requestStagedWorkbookUpload,
  resolveStagedWorkbookUpload,
} from './stagedWorkbookUpload.js';

const mocks = vi.hoisted(() => ({
  createPresignedPutUrlToS3: vi.fn(),
  downloadObjectFromS3: vi.fn(),
}));

vi.mock('../s3Client.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../s3Client.js')>()),
  createPresignedPutUrlToS3: mocks.createPresignedPutUrlToS3,
  downloadObjectFromS3: mocks.downloadObjectFromS3,
}));

const config: BucketS3Config = {
  bucket: 'tableau-workbooks',
  region: 'us-east-1',
  keyPrefix: 'mcp/',
  presignTtlSeconds: 300,
};

const uploadId = '123e4567-e89b-42d3-a456-426614174000';

describe('requestStagedWorkbookUpload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createPresignedPutUrlToS3.mockResolvedValue('https://s3.example.com/signed-put');
  });

  it('returns a presigned PUT URL and workbook upload id', async () => {
    const result = await requestStagedWorkbookUpload({
      fileName: 'BoltBikes Workbook.twb',
      contentType: 'application/xml',
      config,
      generateUuid: () => uploadId,
      now: () => new Date('2026-08-12T18:00:00.000Z'),
    });

    expect(result).toEqual({
      workbookUploadId: uploadId,
      uploadUrl: 'https://s3.example.com/signed-put',
      expiresAt: '2026-08-12T18:05:00.000Z',
      maxSizeBytes: MAX_STAGED_WORKBOOK_BYTES,
      requiredHeaders: { 'Content-Type': 'application/xml' },
    });
    expect(mocks.createPresignedPutUrlToS3).toHaveBeenCalledWith({
      key: `mcp/workbook-uploads/${uploadId}/workbook.twb`,
      contentType: 'application/xml',
      bucket: 'tableau-workbooks',
      region: 'us-east-1',
      presignTtlSeconds: 300,
    });
  });

  it('rejects non-TWB filenames', async () => {
    await expect(
      requestStagedWorkbookUpload({
        fileName: 'workbook.xml',
        config,
        generateUuid: () => uploadId,
      }),
    ).rejects.toThrow('filename must end in .twb');
  });
});

describe('resolveStagedWorkbookUpload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.downloadObjectFromS3.mockResolvedValue(Buffer.from('<workbook />'));
  });

  it('downloads the staged workbook bytes from the deterministic S3 key', async () => {
    await expect(
      resolveStagedWorkbookUpload({ workbookUploadId: uploadId, config }),
    ).resolves.toEqual({
      fileName: `${uploadId}.twb`,
      bytes: Buffer.from('<workbook />'),
    });
    expect(mocks.downloadObjectFromS3).toHaveBeenCalledWith({
      key: `mcp/workbook-uploads/${uploadId}/workbook.twb`,
      bucket: 'tableau-workbooks',
      region: 'us-east-1',
      maxBytes: MAX_STAGED_WORKBOOK_BYTES,
    });
  });

  it('rejects invalid workbook upload ids', async () => {
    await expect(
      resolveStagedWorkbookUpload({ workbookUploadId: '../not-safe', config }),
    ).rejects.toThrow('upload id is invalid');
  });

  it('rejects empty uploaded workbook bytes', async () => {
    mocks.downloadObjectFromS3.mockResolvedValue(Buffer.alloc(0));

    await expect(
      resolveStagedWorkbookUpload({ workbookUploadId: uploadId, config }),
    ).rejects.toThrow('must not be empty');
  });
});

describe('buildWorkbookUploadS3Key', () => {
  it('normalizes the configured prefix', () => {
    expect(buildWorkbookUploadS3Key('/base', uploadId)).toBe(
      `base/workbook-uploads/${uploadId}/workbook.twb`,
    );
  });
});
