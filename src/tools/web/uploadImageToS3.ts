import { randomUUID } from 'node:crypto';

/**
 * Socket-idle timeouts (ms) for the S3 client's Node HTTP handler.
 *
 * These are *idle* timeouts — they fire when the socket sees no data movement
 * for the window, not a total-duration cap. A healthy upload of any realistic
 * view image (KB to low-MB) moves data continuously and completes in well under
 * a second, so these never fire in the normal case; they exist purely to bound
 * a stalled/hung connection so the in-flight image buffer is released rather
 * than pinned indefinitely.
 *
 * `requestTimeout` is 3 minutes: enormous headroom for real images (even a
 * multi-GB payload would transfer within it on any healthy link), while still
 * capping a dead socket. `connectionTimeout` bounds the initial TCP/TLS connect.
 */
const S3_CONNECTION_TIMEOUT_MS = 5_000;
const S3_REQUEST_TIMEOUT_MS = 180_000;

/**
 * Configuration needed to upload a rendered view image to S3 and presign a URL.
 * Mirrors the `imageS3` slice of {@link Config}.
 */
export interface ImageS3Config {
  bucket: string;
  region: string;
  keyPrefix: string;
  presignTtlSeconds: number;
}

/**
 * Lazily-created, module-scoped S3 client bundle.
 *
 * The `@aws-sdk/*` packages are imported dynamically (rather than at the top of
 * the module) so their module bodies are only evaluated — and the client only
 * constructed — the first time an image is actually uploaded. Deployments that
 * don't set IMAGE_S3_BUCKET never reach this code path, so the SDK is never
 * initialized or loaded into memory there. (Note: in the bundled production
 * build the SDK bytes are still inlined into the output; the dynamic import
 * defers runtime initialization, not the packaged size.)
 *
 * The AWS SDK v3 Node HTTP handler enables keep-alive by default, so a single
 * cached client reuses connections across uploads.
 */
let s3BundlePromise:
  | Promise<{
      client: any;

      PutObjectCommand: any;

      GetObjectCommand: any;

      getSignedUrl: any;
    }>
  | undefined;

async function getS3Bundle(region: string): Promise<{
  client: any;

  PutObjectCommand: any;

  GetObjectCommand: any;

  getSignedUrl: any;
}> {
  if (!s3BundlePromise) {
    s3BundlePromise = (async () => {
      const { S3Client, PutObjectCommand, GetObjectCommand } = await import('@aws-sdk/client-s3');
      const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
      // Credentials are resolved via the default AWS credential chain (Model A):
      // IAM role / instance profile / standard AWS_* env vars. We only pass the
      // region; an empty region lets the SDK resolve it from the environment.
      //
      // `requestHandler` is passed as a plain options object: the SDK's node
      // resolver runs it through NodeHttpHandler.create(), so we get the idle
      // timeouts without taking a direct dependency on @smithy/node-http-handler.
      const client = new S3Client({
        ...(region ? { region } : {}),
        requestHandler: {
          connectionTimeout: S3_CONNECTION_TIMEOUT_MS,
          requestTimeout: S3_REQUEST_TIMEOUT_MS,
        },
      });
      return { client, PutObjectCommand, GetObjectCommand, getSignedUrl };
    })();
  }

  return s3BundlePromise;
}

function contentTypeFor(format: 'PNG' | 'SVG'): string {
  return format === 'SVG' ? 'image/svg+xml' : 'image/png';
}

function extensionFor(format: 'PNG' | 'SVG'): string {
  return format === 'SVG' ? 'svg' : 'png';
}

/**
 * Builds the S3 object key for a rendered image. The key namespaces objects
 * under the configured prefix and the source resource id (view or custom view
 * LUID), with a random UUID to avoid collisions between concurrent renders of
 * the same resource.
 */
export function buildImageS3Key(
  keyPrefix: string,
  resourceId: string,
  format: 'PNG' | 'SVG',
): string {
  const normalizedPrefix = keyPrefix.replace(/^\/+/, '').replace(/\/*$/, '/');
  return `${normalizedPrefix}${resourceId}/${randomUUID()}.${extensionFor(format)}`;
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
  }: {
    format: 'PNG' | 'SVG';
    resourceId: string;
    config: ImageS3Config;
  },
): Promise<string> {
  const buffer = Buffer.isBuffer(imageData) ? imageData : Buffer.from(imageData);
  const { client, PutObjectCommand, GetObjectCommand, getSignedUrl } = await getS3Bundle(
    config.region,
  );

  const key = buildImageS3Key(config.keyPrefix, resourceId, format);

  await client.send(
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: key,
      Body: buffer,
      ContentType: contentTypeFor(format),
    }),
  );

  return await getSignedUrl(client, new GetObjectCommand({ Bucket: config.bucket, Key: key }), {
    expiresIn: config.presignTtlSeconds,
  });
}

export const exportedForTesting = {
  resetS3Bundle: (): void => {
    s3BundlePromise = undefined;
  },
};
