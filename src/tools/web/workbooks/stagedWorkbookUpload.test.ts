import { TenantLuids } from '../../../blobStorage/tenantKey.js';
import {
  buildWorkbookUploadKey,
  getWorkbookFileType,
  MAX_STAGED_WORKBOOK_BYTES,
  requestStagedWorkbookUpload,
  resolveStagedWorkbookUpload,
} from './stagedWorkbookUpload.js';

const mocks = vi.hoisted(() => ({
  getPresignedUploadUrl: vi.fn(),
  download: vi.fn(),
}));

vi.mock('../../../blobStorage/init.js', () => ({
  getBlobStorageProvider: vi.fn(() => ({
    getPresignedUploadUrl: mocks.getPresignedUploadUrl,
    download: mocks.download,
  })),
}));

const uploadId = '123e4567-e89b-42d3-a456-426614174000';
const MOCK_SITE_LUID = '0a1b2c3d-1111-4222-8333-444455556666';
const MOCK_USER_LUID = '9f8e7d6c-aaaa-4bbb-8ccc-ddddeeeeffff';
const tenant: TenantLuids = { siteLuid: MOCK_SITE_LUID, userLuid: MOCK_USER_LUID };
const tenantPrefix = `${MOCK_SITE_LUID}/${MOCK_USER_LUID}`;

async function* streamOf(...pieces: string[]): AsyncGenerator<Uint8Array> {
  for (const piece of pieces) {
    yield Buffer.from(piece);
  }
}

describe('requestStagedWorkbookUpload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPresignedUploadUrl.mockResolvedValue({
      uploadUrl: 'https://blob.example.com/signed-put',
      requiredHeaders: { 'Content-Type': 'application/xml' },
      expiresAt: '2026-08-12T18:05:00.000Z',
    });
  });

  it('returns a presigned upload URL and workbook upload id', async () => {
    const result = await requestStagedWorkbookUpload({
      fileName: 'BoltBikes Workbook.twb',
      tenant,
    });

    expect(result).toMatchObject({
      uploadUrl: 'https://blob.example.com/signed-put',
      expiresAt: '2026-08-12T18:05:00.000Z',
      maxSizeBytes: MAX_STAGED_WORKBOOK_BYTES,
      requiredHeaders: { 'Content-Type': 'application/xml' },
    });
    expect(result.workbookUploadId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(mocks.getPresignedUploadUrl).toHaveBeenCalledWith({
      key: `${tenantPrefix}/workbook-uploads/${result.workbookUploadId}/workbook.twb`,
      contentType: 'application/xml',
    });
  });

  it('returns an octet-stream content type for TWBX filenames', async () => {
    mocks.getPresignedUploadUrl.mockResolvedValue({
      uploadUrl: 'https://blob.example.com/signed-put',
      requiredHeaders: { 'Content-Type': 'application/octet-stream' },
      expiresAt: '2026-08-12T18:05:00.000Z',
    });

    const result = await requestStagedWorkbookUpload({
      fileName: 'BoltBikes Workbook.twbx',
      tenant,
    });

    expect(result).toMatchObject({
      requiredHeaders: { 'Content-Type': 'application/octet-stream' },
    });
    expect(mocks.getPresignedUploadUrl).toHaveBeenCalledWith({
      key: `${tenantPrefix}/workbook-uploads/${result.workbookUploadId}/workbook.twbx`,
      contentType: 'application/octet-stream',
    });
  });

  it('uses the requiredHeaders and expiresAt returned by the blob storage provider', async () => {
    mocks.getPresignedUploadUrl.mockResolvedValue({
      uploadUrl: 'https://blob.example.com/signed-put',
      requiredHeaders: { 'Content-Type': 'application/xml', 'x-custom-header': 'value' },
      expiresAt: '2099-01-01T00:00:00.000Z',
    });

    const result = await requestStagedWorkbookUpload({
      fileName: 'BoltBikes Workbook.twb',
      tenant,
    });

    expect(result.requiredHeaders).toEqual({
      'Content-Type': 'application/xml',
      'x-custom-header': 'value',
    });
    expect(result.expiresAt).toBe('2099-01-01T00:00:00.000Z');
  });

  it('rejects filenames that are neither TWB nor TWBX', async () => {
    await expect(
      requestStagedWorkbookUpload({
        fileName: 'workbook.xml',
        tenant,
      }),
    ).rejects.toThrow('filename must end in .twb or .twbx');
  });

  it('rejects an invalid tenant without presigning anything', async () => {
    await expect(
      requestStagedWorkbookUpload({
        fileName: 'workbook.twb',
        tenant: { siteLuid: '../other-site', userLuid: MOCK_USER_LUID },
      }),
    ).rejects.toThrow('Invalid tenant LUIDs for blob storage key.');
    expect(mocks.getPresignedUploadUrl).not.toHaveBeenCalled();
  });
});

describe('resolveStagedWorkbookUpload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the staged workbook stream from the .twb key when it exists', async () => {
    const content = streamOf('<workbook />');
    mocks.download.mockResolvedValue(content);

    await expect(
      resolveStagedWorkbookUpload({ workbookUploadId: uploadId, tenant }),
    ).resolves.toEqual({
      fileName: `${uploadId}.twb`,
      content,
    });
    expect(mocks.download).toHaveBeenCalledWith({
      key: `${tenantPrefix}/workbook-uploads/${uploadId}/workbook.twb`,
      maxBytes: MAX_STAGED_WORKBOOK_BYTES,
    });
    expect(mocks.download).toHaveBeenCalledTimes(1);
  });

  it('falls back to the .twbx key when the .twb key does not exist', async () => {
    const content = streamOf('PK\x03\x04');
    mocks.download.mockResolvedValueOnce(undefined);
    mocks.download.mockResolvedValueOnce(content);

    await expect(
      resolveStagedWorkbookUpload({ workbookUploadId: uploadId, tenant }),
    ).resolves.toEqual({
      fileName: `${uploadId}.twbx`,
      content,
    });
    expect(mocks.download).toHaveBeenNthCalledWith(1, {
      key: `${tenantPrefix}/workbook-uploads/${uploadId}/workbook.twb`,
      maxBytes: MAX_STAGED_WORKBOOK_BYTES,
    });
    expect(mocks.download).toHaveBeenNthCalledWith(2, {
      key: `${tenantPrefix}/workbook-uploads/${uploadId}/workbook.twbx`,
      maxBytes: MAX_STAGED_WORKBOOK_BYTES,
    });
  });

  it('throws when neither the .twb nor .twbx key exists', async () => {
    mocks.download.mockResolvedValue(undefined);

    await expect(
      resolveStagedWorkbookUpload({ workbookUploadId: uploadId, tenant }),
    ).rejects.toThrow('Workbook upload not found');
  });

  it("does not resolve an upload staged by another tenant, since the key is rebuilt from the caller's identity", async () => {
    const otherTenant = {
      siteLuid: '11111111-2222-4333-8444-555555555555',
      userLuid: MOCK_USER_LUID,
    };
    const stagedKey = buildWorkbookUploadKey(tenant, uploadId, 'twb');
    mocks.download.mockImplementation(async ({ key }: { key: string }) =>
      key === stagedKey ? streamOf('<workbook />') : undefined,
    );

    await expect(
      resolveStagedWorkbookUpload({ workbookUploadId: uploadId, tenant: otherTenant }),
    ).rejects.toThrow('Workbook upload not found');
    for (const [{ key }] of mocks.download.mock.calls) {
      expect(key).toContain(`${otherTenant.siteLuid}/${otherTenant.userLuid}/`);
    }
  });

  it('rejects an empty tenant without downloading', async () => {
    await expect(
      resolveStagedWorkbookUpload({
        workbookUploadId: uploadId,
        tenant: { siteLuid: MOCK_SITE_LUID, userLuid: '' },
      }),
    ).rejects.toThrow('Invalid tenant LUIDs for blob storage key.');
    expect(mocks.download).not.toHaveBeenCalled();
  });

  it('rejects invalid workbook upload ids', async () => {
    await expect(
      resolveStagedWorkbookUpload({ workbookUploadId: '../not-safe', tenant }),
    ).rejects.toThrow('upload id is invalid');
  });
});

describe('buildWorkbookUploadKey', () => {
  it('builds a tenant-scoped key without any other prefix', () => {
    expect(buildWorkbookUploadKey(tenant, uploadId, 'twb')).toBe(
      `${tenantPrefix}/workbook-uploads/${uploadId}/workbook.twb`,
    );
  });

  it('includes the file type extension', () => {
    expect(buildWorkbookUploadKey(tenant, uploadId, 'twbx')).toBe(
      `${tenantPrefix}/workbook-uploads/${uploadId}/workbook.twbx`,
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
