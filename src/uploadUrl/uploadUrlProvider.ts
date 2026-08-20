/**
 * Public, dependency-free provider contract for the workbook upload URL.
 *
 * This module is exposed as a package subpath (`@tableau/mcp-server/uploadUrl/uploadUrlProvider`)
 * so external deployments can implement a custom upload URL provider against a stable type,
 * without importing the server's internal config schemas. Keep it free of runtime dependencies.
 */

/**
 * Upload URL provider interface.
 *
 * `request-workbook-upload` calls this to obtain the URL the MCP client should PUT
 * the workbook bytes to. The default (server) provider mints a raw S3 presigned PUT
 * URL; a custom provider may return a first-party URL that fronts the same storage,
 * as long as the bytes end up at the same S3 `key`.
 */
export interface UploadUrlProvider {
  /**
   * Get the URL to upload workbook bytes to, plus the headers the client must send.
   *
   * Returns a Promise so providers can perform a real async operation per invocation
   * (e.g. minting a signed token). The `key`/`bucket`/`region` describe where the
   * default provider stores the object; a custom provider may route the upload
   * elsewhere as long as bytes end up at that same key.
   */
  getUploadUrl(params: {
    workbookUploadId: string;
    key: string;
    bucket: string;
    region: string;
    contentType: string;
    presignTtlSeconds: number;
  }): Promise<{ uploadUrl: string; requiredHeaders: Record<string, string> }>;
}
