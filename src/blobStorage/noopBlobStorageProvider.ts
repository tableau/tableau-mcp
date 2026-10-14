/**
 * NoOp blob storage provider - throws on every operation.
 * This is the default provider when no custom blob storage provider is configured.
 *
 * Unlike telemetry/feature-gate noop providers (which silently do nothing), blob
 * storage has no safe no-op behavior: callers need real bytes back. Throwing makes
 * "blob storage isn't configured" an explicit, catchable failure instead of a
 * silent undefined/empty result.
 */

import { BlobStorageNotConfiguredError } from '../errors/mcpToolError.js';
import type { BlobStorageProvider } from './blobStorageProvider.js';

export class NoopBlobStorageProvider implements BlobStorageProvider {
  async upload(): Promise<{ url: string; expiresAt?: string }> {
    throw new BlobStorageNotConfiguredError();
  }

  async getPresignedUploadUrl(): Promise<{
    uploadUrl: string;
    requiredHeaders: Record<string, string>;
    expiresAt?: string;
  }> {
    throw new BlobStorageNotConfiguredError();
  }

  async download(): Promise<Buffer | undefined> {
    throw new BlobStorageNotConfiguredError();
  }
}
