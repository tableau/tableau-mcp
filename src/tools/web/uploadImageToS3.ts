import { randomUUID } from 'node:crypto';

import { TenantLuids } from '../../blobStorage/tenantKey.js';
import {
  BucketS3Config,
  buildTenantS3Key,
  exportedForTesting,
  joinS3Prefix,
  uploadBufferToS3,
} from './s3Client.js';

// Re-exported for existing importers/tests that reference the shared helpers
// through this module.
export { BucketS3Config, exportedForTesting, joinS3Prefix as joinImageS3Prefix };

function contentTypeFor(format: 'PNG' | 'SVG'): string {
  return format === 'SVG' ? 'image/svg+xml' : 'image/png';
}

function extensionFor(format: 'PNG' | 'SVG'): string {
  return format === 'SVG' ? 'svg' : 'png';
}

/**
 * Builds the S3 object key for a rendered image:
 * `<keyPrefix>/<keyPrefixSegment>/<siteLuid>/<userLuid>/<resourceId>/<uuid>.<ext>`.
 * The resource id is the view or custom view LUID, and the random UUID avoids
 * collisions between concurrent renders of the same resource. Throws if the
 * tenant LUIDs aren't safe key segments, so an unscoped key is never built.
 */
export function buildImageS3Key(
  keyPrefix: string,
  tenant: TenantLuids,
  keyPrefixSegment: string,
  resourceId: string,
  format: 'PNG' | 'SVG',
): string {
  return buildTenantS3Key(
    keyPrefix,
    tenant,
    keyPrefixSegment,
    `${resourceId}/${randomUUID()}.${extensionFor(format)}`,
  );
}

/**
 * Uploads a rendered view image to S3 and returns a short-lived presigned GET
 * URL. The raw image buffer is uploaded directly (no base64), so the object is
 * the exact bytes Tableau rendered.
 *
 * Throws if the upload or presign fails; callers are expected to catch and fall
 * back to returning inline base64 so image retrieval never hard-fails.
 */
export async function uploadImageToS3(
  imageData: Buffer | string,
  {
    format,
    resourceId,
    config,
    keyPrefixSegment,
    tenant,
  }: {
    format: 'PNG' | 'SVG';
    resourceId: string;
    config: BucketS3Config;
    keyPrefixSegment: string;
    tenant: TenantLuids;
  },
): Promise<string> {
  const buffer = Buffer.isBuffer(imageData) ? imageData : Buffer.from(imageData);
  const key = buildImageS3Key(config.keyPrefix, tenant, keyPrefixSegment, resourceId, format);

  return await uploadBufferToS3(buffer, {
    key,
    contentType: contentTypeFor(format),
    bucket: config.bucket,
    region: config.region,
    presignTtlSeconds: config.presignTtlSeconds,
  });
}
