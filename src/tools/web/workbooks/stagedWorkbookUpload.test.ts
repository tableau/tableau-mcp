import { BucketS3Config } from '../s3Client.js';
import { MOCK_SITE_LUID, MOCK_USER_LUID } from '../toolContext.mock.js';
import {
  buildWorkbookUploadS3Key,
  getWorkbookFileType,
  MAX_STAGED_WORKBOOK_BYTES,
  requestStagedWorkbookUpload,
  resolveStagedWorkbookUpload,
} from './stagedWorkbookUpload.js';

const mocks = vi.hoisted(() => ({
  createPresignedPutUrlToS3: vi.fn(),
  downloadObjectFromS3IfExists: vi.fn(),
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
const tenant = { siteLuid: MOCK_SITE_LUID, userLuid: MOCK_USER_LUID };
const tenantPrefix = `${MOCK_SITE_LUID}/${MOCK_USER_LUID}`;

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
      fileSizeBytes: 482133,
      config,
      tenant,
    });

    expect(result).toMatchObject({
      uploadUrl: 'https://s3.example.com/signed-put',
      expiresAt: '2026-08-12T18:05:00.000Z',
      maxSizeBytes: MAX_STAGED_WORKBOOK_BYTES,
      requiredHeaders: { 'Content-Type': 'application/xml', 'Content-Length': '482133' },
    });
    expect(result.workbookUploadId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(mocks.createPresignedPutUrlToS3).toHaveBeenCalledWith({
      key: `mcp/workbook-uploads/${tenantPrefix}/${result.workbookUploadId}/workbook.twb`,
      contentType: 'application/xml',
      contentLength: 482133,
      bucket: 'tableau-workbooks',
      region: 'us-east-1',
      presignTtlSeconds: 300,
    });
  });

  it('returns an octet-stream content type for TWBX filenames', async () => {
    const result = await requestStagedWorkbookUpload({
      fileName: 'BoltBikes Workbook.twbx',
      fileSizeBytes: 482133,
      config,
      tenant,
    });

    expect(result).toMatchObject({
      requiredHeaders: { 'Content-Type': 'application/octet-stream', 'Content-Length': '482133' },
    });
    expect(mocks.createPresignedPutUrlToS3).toHaveBeenCalledWith({
      key: `mcp/workbook-uploads/${tenantPrefix}/${result.workbookUploadId}/workbook.twbx`,
      contentType: 'application/octet-stream',
      contentLength: 482133,
      bucket: 'tableau-workbooks',
      region: 'us-east-1',
      presignTtlSeconds: 300,
    });
  });

  it('rejects filenames that are neither TWB nor TWBX', async () => {
    await expect(
      requestStagedWorkbookUpload({
        fileName: 'workbook.xml',
        fileSizeBytes: 482133,
        config,
        tenant,
      }),
    ).rejects.toThrow('Workbook upload filename must end in .twb or .twbx.');
  });

  it('rejects an invalid tenant without presigning anything', async () => {
    await expect(
      requestStagedWorkbookUpload({
        fileName: 'workbook.twb',
        fileSizeBytes: 482133,
        config,
        tenant: { siteLuid: '../other-site', userLuid: MOCK_USER_LUID },
      }),
    ).rejects.toThrow('Invalid tenant LUIDs for blob storage key.');
    expect(mocks.createPresignedPutUrlToS3).not.toHaveBeenCalled();
  });
});

describe('resolveStagedWorkbookUpload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.downloadObjectFromS3IfExists.mockResolvedValue(Buffer.from('<workbook />'));
  });

  it('downloads the staged workbook bytes from the .twb key when it exists', async () => {
    await expect(
      resolveStagedWorkbookUpload({ workbookUploadId: uploadId, config, tenant }),
    ).resolves.toEqual({
      fileName: `${uploadId}.twb`,
      bytes: Buffer.from('<workbook />'),
    });
    expect(mocks.downloadObjectFromS3IfExists).toHaveBeenCalledWith({
      key: `mcp/workbook-uploads/${tenantPrefix}/${uploadId}/workbook.twb`,
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
      resolveStagedWorkbookUpload({ workbookUploadId: uploadId, config, tenant }),
    ).resolves.toEqual({
      fileName: `${uploadId}.twbx`,
      bytes: Buffer.from('PK\x03\x04'),
    });
    expect(mocks.downloadObjectFromS3IfExists).toHaveBeenNthCalledWith(1, {
      key: `mcp/workbook-uploads/${tenantPrefix}/${uploadId}/workbook.twb`,
      bucket: 'tableau-workbooks',
      region: 'us-east-1',
      maxBytes: MAX_STAGED_WORKBOOK_BYTES,
    });
    expect(mocks.downloadObjectFromS3IfExists).toHaveBeenNthCalledWith(2, {
      key: `mcp/workbook-uploads/${tenantPrefix}/${uploadId}/workbook.twbx`,
      bucket: 'tableau-workbooks',
      region: 'us-east-1',
      maxBytes: MAX_STAGED_WORKBOOK_BYTES,
    });
  });

  it('throws when neither the .twb nor .twbx key exists', async () => {
    mocks.downloadObjectFromS3IfExists.mockResolvedValue(undefined);

    await expect(
      resolveStagedWorkbookUpload({ workbookUploadId: uploadId, config, tenant }),
    ).rejects.toThrow('Workbook upload not found. Upload the workbook bytes before publishing.');
  });

  it.each([
    ['other site', { siteLuid: '11111111-2222-4333-8444-555555555555', userLuid: MOCK_USER_LUID }],
    ['other user', { siteLuid: MOCK_SITE_LUID, userLuid: '66666666-7777-4888-9999-aaaaaaaaaaaa' }],
  ])('does not resolve an upload staged by another tenant (%s)', async (_, otherTenant) => {
    const stagedKey = buildWorkbookUploadS3Key(config.keyPrefix, tenant, uploadId, 'twb');
    mocks.downloadObjectFromS3IfExists.mockImplementation(async ({ key }: { key: string }) =>
      key === stagedKey ? Buffer.from('<workbook />') : undefined,
    );

    await expect(
      resolveStagedWorkbookUpload({ workbookUploadId: uploadId, config, tenant: otherTenant }),
    ).rejects.toThrow('Workbook upload not found');
    for (const [{ key }] of mocks.downloadObjectFromS3IfExists.mock.calls) {
      expect(key).toContain(`${otherTenant.siteLuid}/${otherTenant.userLuid}/`);
    }
  });

  it('rejects an empty tenant without downloading', async () => {
    await expect(
      resolveStagedWorkbookUpload({
        workbookUploadId: uploadId,
        config,
        tenant: { siteLuid: MOCK_SITE_LUID, userLuid: '' },
      }),
    ).rejects.toThrow('Invalid tenant LUIDs for blob storage key.');
    expect(mocks.downloadObjectFromS3IfExists).not.toHaveBeenCalled();
  });

  it('rejects invalid workbook upload ids', async () => {
    await expect(
      resolveStagedWorkbookUpload({ workbookUploadId: '../not-safe', config, tenant }),
    ).rejects.toThrow('Workbook upload id is invalid.');
  });

  it('rejects empty uploaded workbook bytes', async () => {
    mocks.downloadObjectFromS3IfExists.mockResolvedValue(Buffer.alloc(0));

    await expect(
      resolveStagedWorkbookUpload({ workbookUploadId: uploadId, config, tenant }),
    ).rejects.toThrow('Workbook upload bytes must not be empty.');
  });
});

describe('buildWorkbookUploadS3Key', () => {
  it('normalizes the configured prefix', () => {
    expect(buildWorkbookUploadS3Key('/base', tenant, uploadId, 'twb')).toBe(
      `base/workbook-uploads/${tenantPrefix}/${uploadId}/workbook.twb`,
    );
  });

  it('builds a tenant-scoped key when no prefix is configured', () => {
    expect(buildWorkbookUploadS3Key('', tenant, uploadId, 'twb')).toBe(
      `workbook-uploads/${tenantPrefix}/${uploadId}/workbook.twb`,
    );
  });

  it('includes the file type extension', () => {
    expect(buildWorkbookUploadS3Key('/base', tenant, uploadId, 'twbx')).toBe(
      `base/workbook-uploads/${tenantPrefix}/${uploadId}/workbook.twbx`,
    );
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
