import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import { BucketS3Config, exportedForTesting } from './s3Client.js';
import { buildDataS3Key, uploadCsvToS3 } from './uploadDataToS3.js';

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
  bucket: 'tableau-data',
  region: 'us-east-1',
  keyPrefix: 'view-data/',
  presignTtlSeconds: 300,
};

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
    });

    expect(url).toBe('https://s3.example.com/signed-url');
    expect(PutObjectCommand).toHaveBeenCalledTimes(1);

    const putInput = vi.mocked(PutObjectCommand).mock.calls[0][0];
    expect(putInput.Bucket).toBe('tableau-data');
    expect(Buffer.isBuffer(putInput.Body)).toBe(true);
    expect((putInput.Body as Buffer).toString('utf-8')).toBe(csv);
    expect(putInput.ContentType).toBe('text/csv; charset=utf-8');
    expect(putInput.Key).toMatch(/^view-data\/view-123\/[0-9a-f-]+\.csv$/);

    expect(mocks.send).toHaveBeenCalledTimes(1);
  });

  it('presigns a GET URL for the same object with the configured TTL', async () => {
    await uploadCsvToS3('a,b\n1,2\n', {
      resourceId: 'view-123',
      config: { ...baseConfig, presignTtlSeconds: 600 },
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
    await uploadCsvToS3('a,b\n', { resourceId: 'view-123', config: baseConfig });
    expect(S3Client).toHaveBeenCalledWith(expect.objectContaining({ region: 'us-east-1' }));
  });

  it('propagates upload failures to the caller', async () => {
    mocks.send.mockRejectedValueOnce(new Error('access denied'));
    await expect(
      uploadCsvToS3('a,b\n', { resourceId: 'view-123', config: baseConfig }),
    ).rejects.toThrow('access denied');
  });
});

describe('buildDataS3Key', () => {
  it('namespaces the key under the prefix and resource id with a random uuid', () => {
    const key = buildDataS3Key('view-data/', 'view-abc');
    expect(key).toMatch(/^view-data\/view-abc\/[0-9a-f-]+\.csv$/);
  });

  it('normalizes leading and missing trailing slashes in the prefix', () => {
    expect(buildDataS3Key('/data', 'r')).toMatch(/^data\/r\/[0-9a-f-]+\.csv$/);
    expect(buildDataS3Key('data/', 'r')).toMatch(/^data\/r\/[0-9a-f-]+\.csv$/);
  });

  it('produces a unique key on each call for the same inputs', () => {
    const a = buildDataS3Key('p/', 'r');
    const b = buildDataS3Key('p/', 'r');
    expect(a).not.toBe(b);
  });
});
