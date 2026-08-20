import { BucketS3Config } from '../s3Client.js';
import {
  buildWorkbookUploadS3Key,
  MAX_STAGED_WORKBOOK_BYTES,
  requestStagedWorkbookUpload,
  resolveStagedWorkbookUpload,
} from './stagedWorkbookUpload.js';

const mocks = vi.hoisted(() => ({
  getUploadUrl: vi.fn(),
  downloadObjectFromS3: vi.fn(),
}));

vi.mock('../../../uploadUrl/init.js', () => ({
  getUploadUrlProvider: vi.fn(() => ({ getUploadUrl: mocks.getUploadUrl })),
}));

vi.mock('../s3Client.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../s3Client.js')>()),
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
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-12T18:00:00.000Z'));
    mocks.getUploadUrl.mockResolvedValue({
      uploadUrl: 'https://mcp.tableau.com/upload/first-party',
      requiredHeaders: { 'Content-Type': 'application/xml', 'X-Upload-Token': 'abc' },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns the upload URL and required headers from the upload URL provider', async () => {
    const result = await requestStagedWorkbookUpload({
      fileName: 'BoltBikes Workbook.twb',
      config,
    });

    expect(result).toMatchObject({
      uploadUrl: 'https://mcp.tableau.com/upload/first-party',
      expiresAt: '2026-08-12T18:05:00.000Z',
      maxSizeBytes: MAX_STAGED_WORKBOOK_BYTES,
      requiredHeaders: { 'Content-Type': 'application/xml', 'X-Upload-Token': 'abc' },
    });
    expect(result.workbookUploadId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(mocks.getUploadUrl).toHaveBeenCalledWith({
      workbookUploadId: result.workbookUploadId,
      key: `mcp/workbook-uploads/${result.workbookUploadId}/workbook.twb`,
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
