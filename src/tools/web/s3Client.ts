/**
 * Shared S3 upload core.
 *
 * This module holds the format-agnostic pieces used by every S3-offload path
 * (rendered view images, view CSV data, ...): the lazily-created, cached S3
 * client bundle, the key-prefix join helper, and a low-level buffer upload +
 * presign. Format-specific concerns (content type, file extension, key layout)
 * live in the per-payload wrappers (e.g. `uploadImageToS3.ts`,
 * `uploadDataToS3.ts`) that call into `uploadBufferToS3` here.
 *
 * Keeping the client bundle here means images and data share a single cached
 * S3 client rather than each constructing their own.
 */

/**
 * Socket-idle timeouts (ms) for the S3 client's Node HTTP handler.
 *
 * These are *idle* timeouts — they fire when the socket sees no data movement
 * for the window, not a total-duration cap. A healthy upload of any realistic
 * payload moves data continuously and completes well within the window, so
 * these never fire in the normal case; they exist purely to bound a
 * stalled/hung connection so the in-flight buffer is released rather than
 * pinned indefinitely.
 *
 * `requestTimeout` is 3 minutes: enormous headroom for real payloads (even a
 * multi-GB body would transfer within it on any healthy link), while still
 * capping a dead socket. `connectionTimeout` bounds the initial TCP/TLS connect.
 */
const S3_CONNECTION_TIMEOUT_MS = 5_000;
const S3_REQUEST_TIMEOUT_MS = 180_000;

/**
 * Configuration needed to upload a payload to S3 and presign a URL.
 * Mirrors the `bucketS3` slice of {@link Config}.
 */
export interface BucketS3Config {
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
 * constructed — the first time a payload is actually uploaded. Deployments that
 * don't set MCP_S3_BUCKET never reach this code path, so the SDK is never
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

/**
 * Joins the shared base key prefix (MCP_IMAGE_PREFIX) with a per-tool segment,
 * inserting exactly one slash between the parts and stripping any leading slash.
 * Either part may be empty: an empty base yields just the tool segment, so the
 * per-tool default applies when no base is configured. The result always ends
 * with a trailing slash so it reads as a folder path.
 */
export function joinS3Prefix(base: string, segment: string): string {
  const joined = [base, segment]
    .map((part) => part.replace(/^\/+/, '').replace(/\/+$/, ''))
    .filter(Boolean)
    .join('/');
  return joined ? `${joined}/` : '';
}

/**
 * Uploads a payload buffer to S3 under `key` and returns a short-lived
 * presigned GET URL. The raw buffer is uploaded directly (no base64), so the
 * object is exactly the bytes passed in.
 *
 * Throws if the upload or presign fails; callers are expected to catch and fall
 * back to an inline result so retrieval never hard-fails.
 */
export async function uploadBufferToS3(
  buffer: Buffer,
  {
    key,
    contentType,
    bucket,
    region,
    presignTtlSeconds,
  }: {
    key: string;
    contentType: string;
    bucket: string;
    region: string;
    presignTtlSeconds: number;
  },
): Promise<string> {
  const { client, PutObjectCommand, GetObjectCommand, getSignedUrl } = await getS3Bundle(region);

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    }),
  );

  return await getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), {
    expiresIn: presignTtlSeconds,
  });
}

export async function createPresignedPutUrlToS3({
  key,
  contentType,
  bucket,
  region,
  presignTtlSeconds,
}: {
  key: string;
  contentType: string;
  bucket: string;
  region: string;
  presignTtlSeconds: number;
}): Promise<string> {
  const { client, PutObjectCommand, getSignedUrl } = await getS3Bundle(region);

  return await getSignedUrl(
    client,
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      ContentType: contentType,
    }),
    { expiresIn: presignTtlSeconds },
  );
}

export async function downloadObjectFromS3({
  key,
  bucket,
  region,
  maxBytes,
}: {
  key: string;
  bucket: string;
  region: string;
  maxBytes: number;
}): Promise<Buffer> {
  const { client, GetObjectCommand } = await getS3Bundle(region);
  const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));

  if (response.ContentLength !== undefined) {
    const contentLength = Number(response.ContentLength);
    if (!Number.isSafeInteger(contentLength) || contentLength < 0) {
      throw new Error('S3 object has an invalid byte length.');
    }
    if (contentLength > maxBytes) {
      throw new Error(`S3 object exceeds the ${maxBytes}-byte limit.`);
    }
  }

  return await bodyToBufferBounded(response.Body, maxBytes);
}

async function bodyToBufferBounded(body: unknown, maxBytes: number): Promise<Buffer> {
  if (!body) {
    throw new Error('S3 object did not return a body.');
  }

  if (Buffer.isBuffer(body)) {
    return assertBufferWithinLimit(body, maxBytes);
  }
  if (body instanceof Uint8Array) {
    return assertBufferWithinLimit(Buffer.from(body), maxBytes);
  }
  if (typeof body === 'string') {
    return assertBufferWithinLimit(Buffer.from(body), maxBytes);
  }
  if (hasTransformToByteArray(body)) {
    return assertBufferWithinLimit(Buffer.from(await body.transformToByteArray()), maxBytes);
  }
  if (isAsyncIterable(body)) {
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    for await (const chunk of body) {
      const buffer = Buffer.isBuffer(chunk)
        ? chunk
        : chunk instanceof Uint8Array
          ? Buffer.from(chunk)
          : Buffer.from(String(chunk));
      totalBytes += buffer.byteLength;
      if (totalBytes > maxBytes) {
        throw new Error(`S3 object exceeds the ${maxBytes}-byte limit.`);
      }
      chunks.push(buffer);
    }
    return Buffer.concat(chunks, totalBytes);
  }

  throw new Error('S3 object body type is not supported.');
}

function assertBufferWithinLimit(buffer: Buffer, maxBytes: number): Buffer {
  if (buffer.byteLength > maxBytes) {
    throw new Error(`S3 object exceeds the ${maxBytes}-byte limit.`);
  }
  return buffer;
}

function hasTransformToByteArray(
  body: unknown,
): body is { transformToByteArray: () => Promise<Uint8Array> } {
  return (
    typeof body === 'object' &&
    body !== null &&
    'transformToByteArray' in body &&
    typeof body.transformToByteArray === 'function'
  );
}

function isAsyncIterable(body: unknown): body is AsyncIterable<Buffer | Uint8Array | string> {
  return (
    typeof body === 'object' &&
    body !== null &&
    Symbol.asyncIterator in body &&
    typeof body[Symbol.asyncIterator] === 'function'
  );
}

export const exportedForTesting = {
  resetS3Bundle: (): void => {
    s3BundlePromise = undefined;
  },
};
