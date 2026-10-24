/**
 * Public, dependency-free provider contract for blob storage.
 *
 * This module is exposed as a package subpath (`@tableau/mcp-server/blobStorage/blobStorageProvider`)
 * so external deployments can implement a custom blob storage provider against a stable type,
 * without importing the server's internal config schemas or zod. Keep it free of runtime dependencies.
 *
 * Only built-in ES types (`AsyncIterable`, `Uint8Array`) are used, so no `@types/node` is needed.
 */

/**
 * Blob storage provider interface for "bring your own infra" upload/download of
 * tool result payloads (e.g. rendered images, exported data) too large to inline.
 *
 * Keys are relative, `/`-delimited paths chosen by the server, and later looked up by the same
 * key. Providers may prepend their own base path but must otherwise store each key as given.
 *
 * Any members added to this interface (or to its params and results) in future will be optional,
 * so existing providers keep compiling. Every `expiresAt` is an ISO-8601 UTC timestamp
 * (e.g. `2026-01-01T00:00:00.000Z`).
 */
export interface BlobStorageProvider {
  /**
   * Upload data and return a URL the caller can use to retrieve it. The URL is handed to the MCP
   * client as-is, so it must be fetchable without credentials and should be short-lived (e.g. a
   * presigned GET).
   *
   * `data` is a stream of byte pieces so large blobs (e.g. multi-GB workbooks) can be streamed;
   * the server currently buffers workbook bytes in memory before handing them over. It can only be
   * assumed to be iterable once. Implementations must consume `data` to completion before
   * resolving.
   *
   * @param params.key - Storage key/path for the blob
   * @param params.data - The bytes to store, as an async iterable (e.g. a Node `Readable`)
   * @param params.contentType - MIME type of the data
   * @param params.contentLength - When present, the exact total byte count of `data`, so S3-style
   *   providers can do a single PUT. When absent the length is unknown and providers must handle
   *   that themselves (e.g. a multipart upload).
   */
  upload(params: {
    key: string;
    data: AsyncIterable<Uint8Array>;
    contentType: string;
    contentLength?: number;
  }): Promise<{ url: string; expiresAt?: string }>;

  /**
   * Get a presigned URL the caller can upload directly to, without proxying
   * bytes through this process.
   *
   * `requiredHeaders` is passed to the client unchanged and must include every header the URL is
   * signed against, including `Content-Type` (set to `contentType`).
   *
   * @param params.key - Storage key/path for the blob
   * @param params.contentType - MIME type the upload must be sent as
   * @param params.maxBytes - Upper bound on the upload size. Providers MAY enforce it in the
   *   signature (e.g. an S3 POST policy `content-length-range`; a plain presigned PUT can't); core
   *   still enforces it when the upload is read back via `download`.
   */
  getPresignedUploadUrl(params: {
    key: string;
    contentType: string;
    maxBytes?: number;
  }): Promise<{ uploadUrl: string; requiredHeaders: Record<string, string>; expiresAt?: string }>;

  /**
   * Download a previously stored blob as a stream of byte pieces, so large blobs (e.g. multi-GB
   * workbooks) can be streamed; the server currently buffers workbook bytes in memory.
   *
   * Providers MUST throw if the object is known to exceed `maxBytes` (e.g. from its content
   * length), MUST NOT truncate, and should return the stream lazily (no bytes read until it is
   * iterated). Core also enforces `maxBytes` while consuming the stream.
   *
   * @param params.key - Storage key/path for the blob
   * @param params.maxBytes - Size limit for the blob
   * @returns `data`, the blob's bytes as an async iterable (e.g. a Node `Readable` or S3 GetObject
   *   `Body`), plus `contentLength` when the provider knows the exact byte count; or undefined
   *   only if the key was not found
   */
  download(params: {
    key: string;
    maxBytes: number;
  }): Promise<{ data: AsyncIterable<Uint8Array>; contentLength?: number } | undefined>;
}
