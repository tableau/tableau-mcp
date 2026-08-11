import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Readable } from 'stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { exportedForTesting, uploadStreamToS3 } from './s3Client.js';

const mocks = vi.hoisted(() => ({
  done: vi.fn(),
  getSignedUrl: vi.fn(),
}));

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn().mockImplementation(() => ({ send: vi.fn() })),
  PutObjectCommand: vi.fn(),
  GetObjectCommand: vi.fn().mockImplementation((input) => ({ __command: 'get', input })),
}));

vi.mock('@aws-sdk/lib-storage', () => ({
  Upload: vi.fn().mockImplementation((options) => ({ done: mocks.done, options })),
}));

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: mocks.getSignedUrl,
}));

describe('uploadStreamToS3', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    exportedForTesting.resetS3Bundle();
    mocks.done.mockResolvedValue({});
    mocks.getSignedUrl.mockResolvedValue('https://s3.example.com/signed-url');
  });

  it('uses managed multipart upload and presigns the uploaded object', async () => {
    const body = Readable.from(Buffer.from('<workbook />'));
    const url = await uploadStreamToS3(body, {
      bucket: 'tableau-artifacts',
      region: 'us-east-1',
      key: 'workbook-downloads/workbook-id/file.twb',
      contentType: 'application/xml',
      contentDisposition: 'attachment; filename="Sales.twb"',
      contentLength: 12,
      presignTtlSeconds: 600,
    });

    expect(url).toBe('https://s3.example.com/signed-url');
    expect(S3Client).toHaveBeenCalledWith(expect.objectContaining({ region: 'us-east-1' }));
    expect(Upload).toHaveBeenCalledWith({
      client: expect.anything(),
      leavePartsOnError: false,
      params: {
        Bucket: 'tableau-artifacts',
        Key: 'workbook-downloads/workbook-id/file.twb',
        Body: body,
        ContentType: 'application/xml',
        ContentDisposition: 'attachment; filename="Sales.twb"',
        ContentLength: 12,
      },
    });
    expect(mocks.done).toHaveBeenCalledTimes(1);

    const getInput = vi.mocked(GetObjectCommand).mock.calls[0][0];
    expect(getInput).toEqual({
      Bucket: 'tableau-artifacts',
      Key: 'workbook-downloads/workbook-id/file.twb',
      ResponseContentDisposition: 'attachment; filename="Sales.twb"',
      ResponseContentType: 'application/xml',
    });
    expect(getSignedUrl).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ __command: 'get' }),
      { expiresIn: 600 },
    );
  });
});
