import { DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';

import { deleteObjectFromS3, exportedForTesting } from './s3Client.js';

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
}));

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn().mockImplementation(() => ({ send: mocks.send })),
  PutObjectCommand: vi.fn(),
  GetObjectCommand: vi.fn(),
  DeleteObjectCommand: vi.fn().mockImplementation((input) => ({ __command: 'delete', input })),
}));

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn(),
}));

const target = {
  key: 'mcp/workbook-uploads/site/user/upload/workbook.twb',
  bucket: 'tableau-workbooks',
  region: 'us-east-1',
};

describe('deleteObjectFromS3', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    exportedForTesting.resetS3Bundle();
    mocks.send.mockResolvedValue({});
  });

  it('deletes exactly the given object using a client for the configured region', async () => {
    await deleteObjectFromS3(target);

    expect(S3Client).toHaveBeenCalledWith(expect.objectContaining({ region: 'us-east-1' }));
    expect(DeleteObjectCommand).toHaveBeenCalledExactlyOnceWith({
      Bucket: 'tableau-workbooks',
      Key: target.key,
    });
    expect(mocks.send).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ __command: 'delete' }),
      { abortSignal: expect.any(AbortSignal) },
    );
  });

  it('propagates S3 failures to the caller', async () => {
    mocks.send.mockRejectedValueOnce(new Error('AccessDenied'));

    await expect(deleteObjectFromS3(target)).rejects.toThrow('AccessDenied');
  });
});
