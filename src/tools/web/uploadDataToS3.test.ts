import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import { BucketS3Config, exportedForTesting } from './s3Client.js';
import { MOCK_SITE_LUID, MOCK_USER_LUID } from './toolContext.mock.js';
import { buildDataS3Key, uploadCsvToS3 } from './uploadDataToS3.js';

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  getSignedUrl: vi.fn(),
}));

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn().mockImplementation(() => ({ send: mocks.send })),
  PutObjectCommand: vi.fn().mockImplementation((input) => ({ __command: 'put', input })),
  GetObjectCommand: vi.fn().mockImplementation((input) => ({ __command: 'get', input })),
  DeleteObjectCommand: vi.fn().mockImplementation((input) => ({ __command: 'delete', input })),
}));

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: mocks.getSignedUrl,
}));

const baseConfig: BucketS3Config = {
  bucket: 'tableau-data',
  region: 'us-east-1',
  keyPrefix: 'tableau/',
  presignTtlSeconds: 300,
};
const tenant = { siteLuid: MOCK_SITE_LUID, userLuid: MOCK_USER_LUID };
const tenantPrefix = `${MOCK_SITE_LUID}/${MOCK_USER_LUID}`;
const keyArgs = { keyPrefixSegment: 'view-data', tenant };

describe('uploadCsvToS3', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    exportedForTesting.resetS3Bundle();
    mocks.send.mockResolvedValue({});
    mocks.getSignedUrl.mockResolvedValue('https://s3.example.com/signed-url');
  });

  it('uploads the CSV as UTF-8 bytes with a text/csv content type', async () => {
    const csv = 'Country,Profit\nCanada,19.5%\n';
    const url = await uploadCsvToS3(csv, {
      resourceId: 'view-123',
      config: baseConfig,
      ...keyArgs,
    });

    expect(url).toBe('https://s3.example.com/signed-url');
    expect(PutObjectCommand).toHaveBeenCalledTimes(1);

    const putInput = vi.mocked(PutObjectCommand).mock.calls[0][0];
    expect(putInput.Bucket).toBe('tableau-data');
    expect(Buffer.isBuffer(putInput.Body)).toBe(true);
    expect((putInput.Body as Buffer).toString('utf-8')).toBe(csv);
    expect(putInput.ContentType).toBe('text/csv; charset=utf-8');
    expect(putInput.Key).toMatch(
      new RegExp(`^tableau/view-data/${tenantPrefix}/view-123/[0-9a-f-]+\\.csv$`),
    );

    expect(mocks.send).toHaveBeenCalledTimes(1);
  });

  it('presigns a GET URL for the same object with the configured TTL', async () => {
    await uploadCsvToS3('a,b\n1,2\n', {
      resourceId: 'view-123',
      config: { ...baseConfig, presignTtlSeconds: 600 },
      ...keyArgs,
    });

    const putInput = vi.mocked(PutObjectCommand).mock.calls[0][0];
    const getInput = vi.mocked(GetObjectCommand).mock.calls[0][0];
    expect(getInput.Bucket).toBe('tableau-data');
    expect(getInput.Key).toBe(putInput.Key);

    expect(getSignedUrl).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ __command: 'get' }),
      { expiresIn: 600 },
    );
  });

  it('creates the S3 client with the configured region', async () => {
    await uploadCsvToS3('a,b\n', { resourceId: 'view-123', config: baseConfig, ...keyArgs });
    expect(S3Client).toHaveBeenCalledWith(expect.objectContaining({ region: 'us-east-1' }));
  });

  it('propagates upload failures to the caller', async () => {
    mocks.send.mockRejectedValueOnce(new Error('access denied'));
    await expect(
      uploadCsvToS3('a,b\n', { resourceId: 'view-123', config: baseConfig, ...keyArgs }),
    ).rejects.toThrow('access denied');
  });

  it('rejects an invalid tenant without uploading anything', async () => {
    await expect(
      uploadCsvToS3('a,b\n', {
        resourceId: 'view-123',
        config: baseConfig,
        keyPrefixSegment: 'view-data',
        tenant: { siteLuid: '', userLuid: MOCK_USER_LUID },
      }),
    ).rejects.toThrow('Invalid tenant LUIDs for blob storage key.');
    expect(mocks.send).not.toHaveBeenCalled();
  });
});

describe('buildDataS3Key', () => {
  it('namespaces the key under the prefix, tool segment, tenant, and resource id with a random uuid', () => {
    const key = buildDataS3Key('tableau/', tenant, 'view-data', 'view-abc');
    expect(key).toMatch(
      new RegExp(`^tableau/view-data/${tenantPrefix}/view-abc/[0-9a-f-]+\\.csv$`),
    );
  });

  it('normalizes leading and missing trailing slashes in the prefix', () => {
    expect(buildDataS3Key('/data', tenant, 'view-data', 'r')).toMatch(
      new RegExp(`^data/view-data/${tenantPrefix}/r/[0-9a-f-]+\\.csv$`),
    );
    expect(buildDataS3Key('data/', tenant, 'view-data', 'r')).toMatch(
      new RegExp(`^data/view-data/${tenantPrefix}/r/[0-9a-f-]+\\.csv$`),
    );
  });

  it('starts with the tool segment when no prefix is configured', () => {
    expect(buildDataS3Key('', tenant, 'custom-view-data', 'r')).toMatch(
      new RegExp(`^custom-view-data/${tenantPrefix}/r/[0-9a-f-]+\\.csv$`),
    );
  });

  it('produces a unique key on each call for the same inputs', () => {
    const a = buildDataS3Key('p/', tenant, 'view-data', 'r');
    const b = buildDataS3Key('p/', tenant, 'view-data', 'r');
    expect(a).not.toBe(b);
  });

  it.each([
    ['an empty site LUID', { siteLuid: '', userLuid: MOCK_USER_LUID }],
    ['an empty user LUID', { siteLuid: MOCK_SITE_LUID, userLuid: '' }],
    ['a path-like site LUID', { siteLuid: '../other', userLuid: MOCK_USER_LUID }],
  ])('refuses to build an unscoped key for %s', (_name, badTenant) => {
    expect(() => buildDataS3Key('p/', badTenant, 'view-data', 'r')).toThrow(
      'Invalid tenant LUIDs for blob storage key.',
    );
  });
});
