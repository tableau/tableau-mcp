import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import { MOCK_SITE_LUID, MOCK_USER_LUID } from './toolContext.mock.js';
import {
  BucketS3Config,
  buildImageS3Key,
  exportedForTesting,
  joinImageS3Prefix,
  uploadImageToS3,
} from './uploadImageToS3.js';

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  getSignedUrl: vi.fn(),
}));

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn().mockImplementation(() => ({ send: mocks.send })),
  PutObjectCommand: vi.fn().mockImplementation((input) => ({ __command: 'put', input })),
  GetObjectCommand: vi.fn().mockImplementation((input) => ({ __command: 'get', input })),
}));

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: mocks.getSignedUrl,
}));

const baseConfig: BucketS3Config = {
  bucket: 'tableau-images',
  region: 'us-east-1',
  keyPrefix: 'tableau/',
  presignTtlSeconds: 300,
};
const tenant = { siteLuid: MOCK_SITE_LUID, userLuid: MOCK_USER_LUID };
const tenantPrefix = `${MOCK_SITE_LUID}/${MOCK_USER_LUID}`;
const keyArgs = { keyPrefixSegment: 'view-images', tenant };

describe('uploadImageToS3', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    exportedForTesting.resetS3Bundle();
    mocks.send.mockResolvedValue({});
    mocks.getSignedUrl.mockResolvedValue('https://s3.example.com/signed-url');
  });

  it('uploads the raw PNG buffer directly (no base64) with a PNG content type', async () => {
    const buffer = Buffer.from('raw-png-bytes');
    const url = await uploadImageToS3(buffer, {
      format: 'PNG',
      resourceId: 'view-123',
      config: baseConfig,
      ...keyArgs,
    });

    expect(url).toBe('https://s3.example.com/signed-url');
    expect(PutObjectCommand).toHaveBeenCalledTimes(1);

    const putInput = vi.mocked(PutObjectCommand).mock.calls[0][0];
    expect(putInput.Bucket).toBe('tableau-images');
    expect(putInput.Body).toBe(buffer);
    expect(Buffer.isBuffer(putInput.Body)).toBe(true);
    expect(putInput.ContentType).toBe('image/png');
    expect(putInput.Key).toMatch(
      new RegExp(`^tableau/view-images/${tenantPrefix}/view-123/[0-9a-f-]+\\.png$`),
    );

    expect(mocks.send).toHaveBeenCalledTimes(1);
  });

  it('uploads SVG with an svg content type and .svg extension', async () => {
    const buffer = Buffer.from('<svg></svg>');
    await uploadImageToS3(buffer, {
      format: 'SVG',
      resourceId: 'view-123',
      config: baseConfig,
      ...keyArgs,
    });

    const putInput = vi.mocked(PutObjectCommand).mock.calls[0][0];
    expect(putInput.ContentType).toBe('image/svg+xml');
    expect(putInput.Key).toMatch(
      new RegExp(`^tableau/view-images/${tenantPrefix}/view-123/[0-9a-f-]+\\.svg$`),
    );
  });

  it('converts a string body to a Buffer before uploading', async () => {
    await uploadImageToS3('raw-png-bytes', {
      format: 'PNG',
      resourceId: 'view-123',
      config: baseConfig,
      ...keyArgs,
    });

    const putInput = vi.mocked(PutObjectCommand).mock.calls[0][0];
    expect(Buffer.isBuffer(putInput.Body)).toBe(true);
    expect((putInput.Body as Buffer).toString()).toBe('raw-png-bytes');
  });

  it('presigns a GET URL for the same object with the configured TTL', async () => {
    await uploadImageToS3(Buffer.from('bytes'), {
      format: 'PNG',
      resourceId: 'view-123',
      config: { ...baseConfig, presignTtlSeconds: 600 },
      ...keyArgs,
    });

    const putInput = vi.mocked(PutObjectCommand).mock.calls[0][0];
    const getInput = vi.mocked(GetObjectCommand).mock.calls[0][0];
    // Presigns the exact object that was uploaded.
    expect(getInput.Bucket).toBe('tableau-images');
    expect(getInput.Key).toBe(putInput.Key);

    expect(getSignedUrl).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ __command: 'get' }),
      { expiresIn: 600 },
    );
  });

  it('creates the S3 client with the configured region', async () => {
    await uploadImageToS3(Buffer.from('bytes'), {
      format: 'PNG',
      resourceId: 'view-123',
      config: baseConfig,
      ...keyArgs,
    });

    expect(S3Client).toHaveBeenCalledWith(expect.objectContaining({ region: 'us-east-1' }));
  });

  it('creates the S3 client with no region when region is empty (SDK resolves it)', async () => {
    await uploadImageToS3(Buffer.from('bytes'), {
      format: 'PNG',
      resourceId: 'view-123',
      config: { ...baseConfig, region: '' },
      ...keyArgs,
    });

    const clientArgs = vi.mocked(S3Client).mock.calls[0][0];
    expect(clientArgs).not.toHaveProperty('region');
  });

  it('configures the S3 client with connection and request idle timeouts', async () => {
    await uploadImageToS3(Buffer.from('bytes'), {
      format: 'PNG',
      resourceId: 'view-123',
      config: baseConfig,
      ...keyArgs,
    });

    expect(S3Client).toHaveBeenCalledWith(
      expect.objectContaining({
        requestHandler: { connectionTimeout: 5_000, requestTimeout: 180_000 },
      }),
    );
  });

  it('reuses a single cached S3 client across uploads', async () => {
    await uploadImageToS3(Buffer.from('a'), {
      format: 'PNG',
      resourceId: 'view-1',
      config: baseConfig,
      ...keyArgs,
    });
    await uploadImageToS3(Buffer.from('b'), {
      format: 'PNG',
      resourceId: 'view-2',
      config: baseConfig,
      ...keyArgs,
    });

    expect(S3Client).toHaveBeenCalledTimes(1);
    expect(mocks.send).toHaveBeenCalledTimes(2);
  });

  it('propagates upload failures to the caller', async () => {
    mocks.send.mockRejectedValueOnce(new Error('access denied'));
    await expect(
      uploadImageToS3(Buffer.from('bytes'), {
        format: 'PNG',
        resourceId: 'view-123',
        config: baseConfig,
        ...keyArgs,
      }),
    ).rejects.toThrow('access denied');
  });

  it('rejects an invalid tenant without uploading anything', async () => {
    await expect(
      uploadImageToS3(Buffer.from('bytes'), {
        format: 'PNG',
        resourceId: 'view-123',
        config: baseConfig,
        keyPrefixSegment: 'view-images',
        tenant: { siteLuid: MOCK_SITE_LUID, userLuid: '' },
      }),
    ).rejects.toThrow('Invalid tenant LUIDs for blob storage key.');
    expect(mocks.send).not.toHaveBeenCalled();
  });
});

describe('buildImageS3Key', () => {
  it('namespaces the key under the prefix, tool segment, tenant, and resource id with a random uuid', () => {
    const key = buildImageS3Key('tableau/', tenant, 'view-images', 'view-abc', 'PNG');
    expect(key).toMatch(
      new RegExp(`^tableau/view-images/${tenantPrefix}/view-abc/[0-9a-f-]+\\.png$`),
    );
  });

  it('normalizes leading and missing trailing slashes in the prefix', () => {
    expect(buildImageS3Key('/images', tenant, 'view-images', 'r', 'SVG')).toMatch(
      new RegExp(`^images/view-images/${tenantPrefix}/r/[0-9a-f-]+\\.svg$`),
    );
    expect(buildImageS3Key('images/', tenant, 'view-images', 'r', 'PNG')).toMatch(
      new RegExp(`^images/view-images/${tenantPrefix}/r/[0-9a-f-]+\\.png$`),
    );
  });

  it('starts with the tool segment when no prefix is configured', () => {
    expect(buildImageS3Key('', tenant, 'custom-view-images', 'r', 'PNG')).toMatch(
      new RegExp(`^custom-view-images/${tenantPrefix}/r/[0-9a-f-]+\\.png$`),
    );
  });

  it('produces a unique key on each call for the same inputs', () => {
    const a = buildImageS3Key('p/', tenant, 'view-images', 'r', 'PNG');
    const b = buildImageS3Key('p/', tenant, 'view-images', 'r', 'PNG');
    expect(a).not.toBe(b);
  });

  it.each([
    ['an empty site LUID', { siteLuid: '', userLuid: MOCK_USER_LUID }],
    ['an empty user LUID', { siteLuid: MOCK_SITE_LUID, userLuid: '' }],
    ['a path-like site LUID', { siteLuid: '../other', userLuid: MOCK_USER_LUID }],
  ])('refuses to build an unscoped key for %s', (_name, badTenant) => {
    expect(() => buildImageS3Key('p/', badTenant, 'view-images', 'r', 'PNG')).toThrow(
      'Invalid tenant LUIDs for blob storage key.',
    );
  });
});

describe('joinImageS3Prefix', () => {
  it('joins a base and a per-tool segment with a single slash and a trailing slash', () => {
    expect(joinImageS3Prefix('tableau/', 'view-images/')).toBe('tableau/view-images/');
  });

  it('falls back to just the segment when the base is empty', () => {
    expect(joinImageS3Prefix('', 'view-images/')).toBe('view-images/');
  });

  it('returns just the base when the segment is empty', () => {
    expect(joinImageS3Prefix('tableau/', '')).toBe('tableau/');
  });

  it('returns an empty string when both parts are empty', () => {
    expect(joinImageS3Prefix('', '')).toBe('');
  });

  it('normalizes leading, trailing, and interior slashes', () => {
    expect(joinImageS3Prefix('/tableau', 'view-images')).toBe('tableau/view-images/');
    expect(joinImageS3Prefix('tableau//', '//view-images//')).toBe('tableau/view-images/');
  });
});
