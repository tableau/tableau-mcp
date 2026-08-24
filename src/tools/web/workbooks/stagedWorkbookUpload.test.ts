import { readFile } from 'fs/promises';

import { BucketS3Config } from '../s3Client.js';
import {
  buildWorkbookUploadS3Key,
  getWorkbookFileType,
  MAX_STAGED_WORKBOOK_BYTES,
  requestStagedWorkbookUpload,
  resolveStagedWorkbookUpload,
  resolveWorkbookInput,
} from './stagedWorkbookUpload.js';

const mocks = vi.hoisted(() => ({
  createPresignedPutUrlToS3: vi.fn(),
  downloadObjectFromS3IfExists: vi.fn(),
}));

vi.mock('fs/promises', () => ({
  readFile: vi.fn(),
}));

vi.mock('../s3Client.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../s3Client.js')>()),
  createPresignedPutUrlToS3: mocks.createPresignedPutUrlToS3,
  downloadObjectFromS3IfExists: mocks.downloadObjectFromS3IfExists,
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
    mocks.createPresignedPutUrlToS3.mockResolvedValue('https://s3.example.com/signed-put');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns a presigned PUT URL and workbook upload id', async () => {
    const result = await requestStagedWorkbookUpload({
      fileName: 'BoltBikes Workbook.twb',
      config,
    });

    expect(result).toMatchObject({
      uploadUrl: 'https://s3.example.com/signed-put',
      expiresAt: '2026-08-12T18:05:00.000Z',
      maxSizeBytes: MAX_STAGED_WORKBOOK_BYTES,
      requiredHeaders: { 'Content-Type': 'application/xml' },
    });
    expect(result.workbookUploadId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(mocks.createPresignedPutUrlToS3).toHaveBeenCalledWith({
      key: `mcp/workbook-uploads/${result.workbookUploadId}/workbook.twb`,
      contentType: 'application/xml',
      bucket: 'tableau-workbooks',
      region: 'us-east-1',
      presignTtlSeconds: 300,
    });
  });

  it('returns an octet-stream content type for TWBX filenames', async () => {
    const result = await requestStagedWorkbookUpload({
      fileName: 'BoltBikes Workbook.twbx',
      config,
    });

    expect(result).toMatchObject({
      requiredHeaders: { 'Content-Type': 'application/octet-stream' },
    });
    expect(mocks.createPresignedPutUrlToS3).toHaveBeenCalledWith({
      key: `mcp/workbook-uploads/${result.workbookUploadId}/workbook.twbx`,
      contentType: 'application/octet-stream',
      bucket: 'tableau-workbooks',
      region: 'us-east-1',
      presignTtlSeconds: 300,
    });
  });

  it('rejects filenames that are neither TWB nor TWBX', async () => {
    await expect(
      requestStagedWorkbookUpload({
        fileName: 'workbook.xml',
        config,
      }),
    ).rejects.toThrow('filename must end in .twb or .twbx');
  });
});

describe('resolveStagedWorkbookUpload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.downloadObjectFromS3IfExists.mockResolvedValue(Buffer.from('<workbook />'));
  });

  it('downloads the staged workbook bytes from the .twb key when it exists', async () => {
    await expect(
      resolveStagedWorkbookUpload({ workbookUploadId: uploadId, config }),
    ).resolves.toEqual({
      fileName: `${uploadId}.twb`,
      bytes: Buffer.from('<workbook />'),
    });
    expect(mocks.downloadObjectFromS3IfExists).toHaveBeenCalledWith({
      key: `mcp/workbook-uploads/${uploadId}/workbook.twb`,
      bucket: 'tableau-workbooks',
      region: 'us-east-1',
      maxBytes: MAX_STAGED_WORKBOOK_BYTES,
    });
    expect(mocks.downloadObjectFromS3IfExists).toHaveBeenCalledTimes(1);
  });

  it('falls back to the .twbx key when the .twb key does not exist', async () => {
    mocks.downloadObjectFromS3IfExists.mockResolvedValueOnce(undefined);
    mocks.downloadObjectFromS3IfExists.mockResolvedValueOnce(Buffer.from('PK\x03\x04'));

    await expect(
      resolveStagedWorkbookUpload({ workbookUploadId: uploadId, config }),
    ).resolves.toEqual({
      fileName: `${uploadId}.twbx`,
      bytes: Buffer.from('PK\x03\x04'),
    });
    expect(mocks.downloadObjectFromS3IfExists).toHaveBeenNthCalledWith(1, {
      key: `mcp/workbook-uploads/${uploadId}/workbook.twb`,
      bucket: 'tableau-workbooks',
      region: 'us-east-1',
      maxBytes: MAX_STAGED_WORKBOOK_BYTES,
    });
    expect(mocks.downloadObjectFromS3IfExists).toHaveBeenNthCalledWith(2, {
      key: `mcp/workbook-uploads/${uploadId}/workbook.twbx`,
      bucket: 'tableau-workbooks',
      region: 'us-east-1',
      maxBytes: MAX_STAGED_WORKBOOK_BYTES,
    });
  });

  it('throws when neither the .twb nor .twbx key exists', async () => {
    mocks.downloadObjectFromS3IfExists.mockResolvedValue(undefined);

    await expect(
      resolveStagedWorkbookUpload({ workbookUploadId: uploadId, config }),
    ).rejects.toThrow('Workbook upload not found');
  });

  it('rejects invalid workbook upload ids', async () => {
    await expect(
      resolveStagedWorkbookUpload({ workbookUploadId: '../not-safe', config }),
    ).rejects.toThrow('upload id is invalid');
  });

  it('rejects empty uploaded workbook bytes', async () => {
    mocks.downloadObjectFromS3IfExists.mockResolvedValue(Buffer.alloc(0));

    await expect(
      resolveStagedWorkbookUpload({ workbookUploadId: uploadId, config }),
    ).rejects.toThrow('must not be empty');
  });
});

describe('buildWorkbookUploadS3Key', () => {
  it('normalizes the configured prefix', () => {
    expect(buildWorkbookUploadS3Key('/base', uploadId, 'twb')).toBe(
      `base/workbook-uploads/${uploadId}/workbook.twb`,
    );
  });

  it('includes the file type extension', () => {
    expect(buildWorkbookUploadS3Key('/base', uploadId, 'twbx')).toBe(
      `base/workbook-uploads/${uploadId}/workbook.twbx`,
    );
  });
});

describe('resolveWorkbookInput', () => {
  const mockReadFile = readFile as unknown as ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockReadFile.mockReset();
  });

  it('throws when both workbookFilePath and workbookUploadId are provided', async () => {
    await expect(
      resolveWorkbookInput({
        config: {
          enabled: true,
          bucket: 'b',
          region: 'us-east-1',
          keyPrefix: '',
          presignTtlSeconds: 300,
        },
        workbookUploadId: '123e4567-e89b-42d3-a456-426614174000',
        workbookFilePath: '/tmp/x.twb',
      }),
    ).rejects.toThrow('Provide either workbookFilePath or workbookUploadId, not both.');
  });

  it('throws when neither workbookFilePath nor workbookUploadId are provided', async () => {
    await expect(
      resolveWorkbookInput({
        config: {
          enabled: true,
          bucket: 'b',
          region: 'us-east-1',
          keyPrefix: '',
          presignTtlSeconds: 300,
        },
      }),
    ).rejects.toThrow('Either workbookFilePath or workbookUploadId must be provided');
  });

  it('throws when workbookFilePath is provided but staged S3 uploads are configured', async () => {
    await expect(
      resolveWorkbookInput({
        config: {
          enabled: true,
          bucket: 'b',
          region: 'us-east-1',
          keyPrefix: '',
          presignTtlSeconds: 300,
        },
        workbookFilePath: '/tmp/x.twb',
      }),
    ).rejects.toThrow(
      'workbookFilePath is only supported when staged S3 uploads are not configured',
    );
  });

  it('throws when workbookUploadId is provided but staged S3 uploads are not configured', async () => {
    await expect(
      resolveWorkbookInput({
        config: {
          enabled: false,
          bucket: 'b',
          region: 'us-east-1',
          keyPrefix: '',
          presignTtlSeconds: 300,
        },
        workbookUploadId: '123e4567-e89b-42d3-a456-426614174000',
      }),
    ).rejects.toThrow('MCP_S3_BUCKET must be configured');
  });

  it('reads a local .twb file when workbookFilePath is provided and S3 is not configured', async () => {
    mockReadFile.mockResolvedValue(Buffer.from('<workbook source="local" />'));

    const result = await resolveWorkbookInput({
      config: {
        enabled: false,
        bucket: 'b',
        region: 'us-east-1',
        keyPrefix: '',
        presignTtlSeconds: 300,
      },
      workbookFilePath: '/tmp/source-superstore.twb',
    });

    expect(result).toEqual({
      fileName: 'source-superstore.twb',
      bytes: Buffer.from('<workbook source="local" />'),
    });
  });

  it('throws when the local file is neither .twb nor .twbx', async () => {
    await expect(
      resolveWorkbookInput({
        config: {
          enabled: false,
          bucket: 'b',
          region: 'us-east-1',
          keyPrefix: '',
          presignTtlSeconds: 300,
        },
        workbookFilePath: '/tmp/source-superstore.xml',
      }),
    ).rejects.toThrow('workbookFilePath must point to a .twb or .twbx file');
  });

  it('throws when the local file is empty', async () => {
    mockReadFile.mockResolvedValue(Buffer.from(''));

    await expect(
      resolveWorkbookInput({
        config: {
          enabled: false,
          bucket: 'b',
          region: 'us-east-1',
          keyPrefix: '',
          presignTtlSeconds: 300,
        },
        workbookFilePath: '/tmp/source-superstore.twb',
      }),
    ).rejects.toThrow('workbookFilePath must not point to an empty workbook file');
  });
});

describe('getWorkbookFileType', () => {
  it('returns twb for .twb filenames', () => {
    expect(getWorkbookFileType('workbook.twb')).toBe('twb');
  });

  it('returns twbx for .twbx filenames', () => {
    expect(getWorkbookFileType('workbook.twbx')).toBe('twbx');
  });

  it('returns undefined for other extensions', () => {
    expect(getWorkbookFileType('workbook.xml')).toBeUndefined();
  });
});
