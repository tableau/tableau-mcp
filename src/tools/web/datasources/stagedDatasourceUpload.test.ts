import { BucketS3Config } from '../s3Client.js';
import { MOCK_SITE_LUID, MOCK_USER_LUID } from '../toolContext.mock.js';
import {
  buildDatasourceUploadS3Key,
  getDatasourceFileType,
  MAX_STAGED_DATASOURCE_BYTES,
  requestStagedDatasourceUpload,
  resolveStagedDatasourceUpload,
} from './stagedDatasourceUpload.js';

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
  bucket: 'tableau-datasources',
  region: 'us-east-1',
  keyPrefix: '/mcp/',
  presignTtlSeconds: 300,
};
const tenant = { siteLuid: MOCK_SITE_LUID, userLuid: MOCK_USER_LUID };
const tenantPrefix = `${MOCK_SITE_LUID}/${MOCK_USER_LUID}`;
const uploadId = '123e4567-e89b-42d3-a456-426614174000';

describe('requestStagedDatasourceUpload', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-14T18:00:00.000Z'));
    mocks.createPresignedPutUrlToS3.mockResolvedValue('https://s3.example.com/signed-put');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    ['Sales.tds', 'tds', 'application/xml'],
    ['Sales.TDSX', 'tdsx', 'application/octet-stream'],
  ])(
    'presigns %s with the matching S3 key, TTL, content type, and bounded size',
    async (fileName, fileType, contentType) => {
      const result = await requestStagedDatasourceUpload({
        fileName,
        fileSizeBytes: 482133,
        config,
        tenant,
      });

      expect(result.datasourceUploadId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
      expect(MAX_STAGED_DATASOURCE_BYTES).toBe(5 * 1000 * 1000 * 1000);
      expect(result).toEqual({
        datasourceUploadId: result.datasourceUploadId,
        uploadUrl: 'https://s3.example.com/signed-put',
        expiresAt: '2026-10-14T18:05:00.000Z',
        maxSizeBytes: 5 * 1000 * 1000 * 1000,
        requiredHeaders: { 'Content-Type': contentType, 'Content-Length': '482133' },
      });
      expect(mocks.createPresignedPutUrlToS3).toHaveBeenCalledExactlyOnceWith({
        key: `mcp/datasource-uploads/${tenantPrefix}/${result.datasourceUploadId}/datasource.${fileType}`,
        contentType,
        contentLength: 482133,
        bucket: config.bucket,
        region: config.region,
        presignTtlSeconds: 300,
      });
    },
  );

  it.each(['Sales.xml', 'Sales.tds.exe', 'Sales', ''])(
    'rejects unsupported filename %j before presigning',
    async (fileName) => {
      await expect(
        requestStagedDatasourceUpload({ fileName, fileSizeBytes: 482133, config, tenant }),
      ).rejects.toThrow('Data source upload filename must end in .tds or .tdsx.');
      expect(mocks.createPresignedPutUrlToS3).not.toHaveBeenCalled();
    },
  );

  it('propagates presign errors', async () => {
    const error = new Error('Unable to presign');
    mocks.createPresignedPutUrlToS3.mockRejectedValue(error);

    await expect(
      requestStagedDatasourceUpload({
        fileName: 'Sales.tds',
        fileSizeBytes: 482133,
        config,
        tenant,
      }),
    ).rejects.toBe(error);
  });
});

describe('resolveStagedDatasourceUpload', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.downloadObjectFromS3IfExists.mockResolvedValue(Buffer.from('<datasource />'));
  });

  function expectedDownload(
    fileType: 'tds' | 'tdsx',
    maxBytes = 5 * 1000 * 1000 * 1000,
  ): { key: string; bucket: string; region: string; maxBytes: number } {
    return {
      key: `mcp/datasource-uploads/${tenantPrefix}/${uploadId}/datasource.${fileType}`,
      bucket: config.bucket,
      region: config.region,
      maxBytes,
    };
  }

  it('returns TDS bytes and applies the default download limit without looking up TDSX', async () => {
    await expect(
      resolveStagedDatasourceUpload({ datasourceUploadId: uploadId, config, tenant }),
    ).resolves.toEqual({
      fileName: `${uploadId}.tds`,
      bytes: Buffer.from('<datasource />'),
      stagedKey: expectedDownload('tds').key,
    });

    expect(mocks.downloadObjectFromS3IfExists).toHaveBeenCalledExactlyOnceWith(
      expectedDownload('tds'),
    );
  });

  it('falls back to TDSX only when the TDS object is absent, preserving the byte limit', async () => {
    const bytes = Buffer.from('PK\x03\x04');
    mocks.downloadObjectFromS3IfExists
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(bytes);

    await expect(
      resolveStagedDatasourceUpload({
        datasourceUploadId: uploadId,
        config,
        tenant,
        maxBytes: 4096,
      }),
    ).resolves.toEqual({
      fileName: `${uploadId}.tdsx`,
      bytes,
      stagedKey: expectedDownload('tdsx').key,
    });

    expect(mocks.downloadObjectFromS3IfExists).toHaveBeenCalledTimes(2);
    expect(mocks.downloadObjectFromS3IfExists).toHaveBeenNthCalledWith(
      1,
      expectedDownload('tds', 4096),
    );
    expect(mocks.downloadObjectFromS3IfExists).toHaveBeenNthCalledWith(
      2,
      expectedDownload('tdsx', 4096),
    );
  });

  it('passes a caller-supplied byte limit to the S3 download', async () => {
    await resolveStagedDatasourceUpload({
      datasourceUploadId: uploadId,
      config,
      tenant,
      maxBytes: 200 * 1024 * 1024,
    });

    expect(mocks.downloadObjectFromS3IfExists).toHaveBeenCalledExactlyOnceWith(
      expectedDownload('tds', 200 * 1024 * 1024),
    );
  });

  it('throws after both file types are absent', async () => {
    mocks.downloadObjectFromS3IfExists.mockResolvedValue(undefined);

    await expect(
      resolveStagedDatasourceUpload({ datasourceUploadId: uploadId, config, tenant }),
    ).rejects.toThrow(
      'Data source upload not found: it was never uploaded, has expired, or was deleted after prior publish. Check whether the data source already exists before requesting a new upload.',
    );
    expect(mocks.downloadObjectFromS3IfExists).toHaveBeenCalledTimes(2);
  });

  it.each(['../not-safe', '', 'not-a-uuid'])(
    'rejects invalid upload id %j before S3 lookup',
    async (datasourceUploadId) => {
      await expect(
        resolveStagedDatasourceUpload({ datasourceUploadId, config, tenant }),
      ).rejects.toThrow('Data source upload id is invalid.');
      expect(mocks.downloadObjectFromS3IfExists).not.toHaveBeenCalled();
    },
  );

  it('rejects an empty TDS without falling back to another object', async () => {
    mocks.downloadObjectFromS3IfExists.mockResolvedValue(Buffer.alloc(0));

    await expect(
      resolveStagedDatasourceUpload({ datasourceUploadId: uploadId, config, tenant }),
    ).rejects.toThrow('Data source upload bytes must not be empty.');
    expect(mocks.downloadObjectFromS3IfExists).toHaveBeenCalledTimes(1);
  });

  it('rejects empty TDSX bytes after fallback', async () => {
    mocks.downloadObjectFromS3IfExists
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(Buffer.alloc(0));

    await expect(
      resolveStagedDatasourceUpload({ datasourceUploadId: uploadId, config, tenant }),
    ).rejects.toThrow('Data source upload bytes must not be empty.');
  });

  it('propagates S3 errors without treating a failed download as a missing object', async () => {
    const error = new Error('Object exceeds byte limit');
    mocks.downloadObjectFromS3IfExists.mockRejectedValue(error);

    await expect(
      resolveStagedDatasourceUpload({ datasourceUploadId: uploadId, config, tenant }),
    ).rejects.toBe(error);
    expect(mocks.downloadObjectFromS3IfExists).toHaveBeenCalledTimes(1);
  });
});

describe('cross-tenant isolation', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it.each([
    ['other site', { siteLuid: '11111111-2222-4333-8444-555555555555', userLuid: tenant.userLuid }],
    ['other user', { siteLuid: tenant.siteLuid, userLuid: '66666666-7777-4888-9999-aaaaaaaaaaaa' }],
  ])('does not resolve an upload staged by another tenant (%s)', async (_, otherTenant) => {
    const stagedKey = buildDatasourceUploadS3Key(config.keyPrefix, tenant, uploadId, 'tds');
    mocks.downloadObjectFromS3IfExists.mockImplementation(async ({ key }: { key: string }) =>
      key === stagedKey ? Buffer.from('<datasource />') : undefined,
    );

    await expect(
      resolveStagedDatasourceUpload({
        datasourceUploadId: uploadId,
        config,
        tenant: otherTenant,
      }),
    ).rejects.toThrow('Data source upload not found');
    for (const [{ key }] of mocks.downloadObjectFromS3IfExists.mock.calls) {
      expect(key).toContain(`${otherTenant.siteLuid}/${otherTenant.userLuid}/`);
    }
  });
});

describe('buildDatasourceUploadS3Key', () => {
  it.each(['tds', 'tdsx'] as const)(
    'normalizes the prefix and includes the %s extension',
    (fileType) => {
      expect(buildDatasourceUploadS3Key('/base/', tenant, uploadId, fileType)).toBe(
        `base/datasource-uploads/${tenantPrefix}/${uploadId}/datasource.${fileType}`,
      );
    },
  );

  it('builds a tenant-scoped key when no prefix is configured', () => {
    expect(buildDatasourceUploadS3Key('', tenant, uploadId, 'tds')).toBe(
      `datasource-uploads/${tenantPrefix}/${uploadId}/datasource.tds`,
    );
  });

  it('rejects an invalid upload id', () => {
    expect(() => buildDatasourceUploadS3Key('base', tenant, '../other', 'tds')).toThrow(
      'Data source upload id is invalid.',
    );
  });
});

describe('getDatasourceFileType', () => {
  it.each([
    ['Sales.tds', 'tds'],
    ['Sales.TDSX', 'tdsx'],
    ['Sales.xml', undefined],
    ['Sales.tds.exe', undefined],
  ])('identifies %s as %s', (fileName, fileType) => {
    expect(getDatasourceFileType(fileName)).toBe(fileType);
  });
});
