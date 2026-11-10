import { createPresignedPutUrlToS3, exportedForTesting } from './s3Client.js';

// Uses the real SDK (no network) so an SDK upgrade that stops signing Content-Length fails here.
describe('createPresignedPutUrlToS3', () => {
  beforeEach(() => {
    exportedForTesting.resetS3Bundle();
    vi.stubEnv('AWS_ACCESS_KEY_ID', 'AKIAIOSFODNN7EXAMPLE');
    vi.stubEnv('AWS_SECRET_ACCESS_KEY', 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    exportedForTesting.resetS3Bundle();
  });

  it('signs Content-Length', async () => {
    const url = new URL(
      await createPresignedPutUrlToS3({
        key: 'workbook-uploads/site/user/id/workbook.twbx',
        contentType: 'application/octet-stream',
        contentLength: 482133,
        bucket: 'tableau-workbooks',
        region: 'us-east-1',
        presignTtlSeconds: 300,
      }),
    );

    expect(url.searchParams.get('X-Amz-SignedHeaders')?.split(';')).toContain('content-length');
  });
});
