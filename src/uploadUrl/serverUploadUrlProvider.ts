import { createPresignedPutUrlToS3 } from '../tools/web/s3Client.js';
import type { UploadUrlProvider } from './uploadUrlProvider.js';

/**
 * Default upload URL provider.
 *
 * Preserves today's behavior: mints a raw S3 presigned PUT URL by delegating to
 * {@link createPresignedPutUrlToS3}, and requires the client to send the object's
 * `Content-Type` header. Used for standalone (OSS) deployments.
 */
export class ServerUploadUrlProvider implements UploadUrlProvider {
  async getUploadUrl({
    key,
    bucket,
    region,
    contentType,
    presignTtlSeconds,
  }: {
    workbookUploadId: string;
    key: string;
    bucket: string;
    region: string;
    contentType: string;
    presignTtlSeconds: number;
  }): Promise<{ uploadUrl: string; requiredHeaders: Record<string, string> }> {
    const uploadUrl = await createPresignedPutUrlToS3({
      key,
      contentType,
      bucket,
      region,
      presignTtlSeconds,
    });

    return { uploadUrl, requiredHeaders: { 'Content-Type': contentType } };
  }
}
