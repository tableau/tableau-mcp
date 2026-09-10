import { randomUUID } from 'node:crypto';

import { BucketS3Config, uploadBufferToS3 } from './s3Client.js';

// CSV is uploaded as UTF-8 text. The charset is spelled out so clients that
// honor it decode the presigned object correctly.
const CSV_CONTENT_TYPE = 'text/csv; charset=utf-8';

/**
 * Builds the S3 object key for a view's CSV data. The key namespaces objects
 * under the configured prefix and the source resource id (view or custom view
 * LUID), with a random UUID to avoid collisions between concurrent exports of
 * the same resource.
 */
export function buildDataS3Key(keyPrefix: string, resourceId: string): string {
  const normalizedPrefix = keyPrefix.replace(/^\/+/, '').replace(/\/*$/, '/');
  return `${normalizedPrefix}${resourceId}/${randomUUID()}.csv`;
}

/**
 * Uploads a view's CSV data to S3 and returns a short-lived presigned GET URL.
 * The CSV text is uploaded as UTF-8 bytes, so the object is exactly the data
 * Tableau returned.
 *
 * Throws if the upload or presign fails; callers are expected to catch and fall
 * back to returning the CSV inline so data retrieval never hard-fails.
 */
export async function uploadCsvToS3(
  csv: string,
  {
    resourceId,
    config,
  }: {
    resourceId: string;
    config: BucketS3Config;
  },
): Promise<string> {
  const buffer = Buffer.from(csv, 'utf-8');
  const key = buildDataS3Key(config.keyPrefix, resourceId);

  return await uploadBufferToS3(buffer, {
    key,
    contentType: CSV_CONTENT_TYPE,
    bucket: config.bucket,
    region: config.region,
    presignTtlSeconds: config.presignTtlSeconds,
  });
}
