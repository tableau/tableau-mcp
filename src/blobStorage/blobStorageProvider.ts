/**
 * Public, dependency-free provider contract for blob storage.
 *
 * This module is exposed as a package subpath (`@tableau/mcp-server/blobStorage/blobStorageProvider`)
 * so external deployments can implement a custom blob storage provider against a stable type,
 * without importing the server's internal config schemas or zod. Keep it free of runtime dependencies.
 *
 * `Buffer` is the ambient Node global type (from `@types/node`, a devDependency-only, compile-time
 * type source -- no runtime dependency is introduced).
 */

/**
 * Blob storage provider interface for "bring your own infra" upload/download of
 * tool result payloads (e.g. rendered images, exported data) too large to inline.
 */
export interface BlobStorageProvider {
  /**
   * Upload data and return a URL the caller can use to retrieve it.
   *
   * @param params.key - Storage key/path for the blob
   * @param params.data - Raw bytes to store
   * @param params.contentType - MIME type of the data
   */
  upload(params: {
    key: string;
    data: Buffer;
    contentType: string;
  }): Promise<{ url: string; expiresAt?: string }>;

  /**
   * Get a presigned URL the caller can upload directly to, without proxying
   * bytes through this process.
   *
   * @param params.key - Storage key/path for the blob
   * @param params.contentType - MIME type the upload must be sent as
   */
  getPresignedUploadUrl(params: {
    key: string;
    contentType: string;
  }): Promise<{ uploadUrl: string; requiredHeaders: Record<string, string>; expiresAt?: string }>;

  /**
   * Download a previously stored blob.
   *
   * @param params.key - Storage key/path for the blob
   * @param params.maxBytes - Reject/truncate downloads larger than this size
   * @returns The blob's bytes, or undefined if the key was not found
   */
  download(params: { key: string; maxBytes: number }): Promise<Buffer | undefined>;
}
