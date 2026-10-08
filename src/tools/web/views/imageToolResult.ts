import { randomUUID } from 'node:crypto';

import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok, Result } from 'ts-results-es';

import { getBlobStorageProvider, isBlobStorageEnabled } from '../../../blobStorage/init.js';
import {
  buildTenantBlobKey,
  getTenantLuids,
  TenantIdentitySource,
  TenantLuids,
} from '../../../blobStorage/tenantKey.js';
import { toUploadData } from '../../../blobStorage/uploadData.js';
import { McpToolError } from '../../../errors/mcpToolError.js';
import { getFeatureGate } from '../../../features/init.js';
import { log } from '../../../logging/logger.js';
import { getExceptionMessage } from '../../../utils/getExceptionMessage.js';
import {
  convertViewImageToToolResult,
  convertViewImageUrlToToolResult,
} from '../convertViewImageToToolResult.js';

/**
 * Discriminated result carried from an image tool's `callback` to its
 * `getSuccessResult`. Either a URL (image offloaded to blob storage) or the raw
 * image bytes (inline base64 fallback).
 *
 * Note: this value is forwarded through `constrainSuccessResult` to
 * `getSuccessResult` only; it is never serialized into logs or telemetry, so
 * carrying the URL here does not leak it into log output.
 */
export type ImageToolResult =
  | { kind: 'url'; url: string; format: 'PNG' | 'SVG' | undefined }
  | { kind: 'inline'; imageData: Buffer | string; format: 'PNG' | 'SVG' | undefined };

function contentTypeFor(format: 'PNG' | 'SVG'): string {
  return format === 'SVG' ? 'image/svg+xml' : 'image/png';
}

function extensionFor(format: 'PNG' | 'SVG'): string {
  return format === 'SVG' ? 'svg' : 'png';
}

/**
 * Builds the tenant-scoped blob storage key for a rendered image. Namespacing/
 * prefixing beyond this key (e.g. an operator-configured base path) is the
 * custom provider's own concern.
 */
function buildImageKey(tenant: TenantLuids, resourceId: string, format: 'PNG' | 'SVG'): string {
  return buildTenantBlobKey(tenant, `images/${resourceId}/${randomUUID()}.${extensionFor(format)}`);
}

/**
 * Given rendered image bytes, either upload them via the configured
 * {@link BlobStorageProvider} and return a URL (when the `view-file-mode`
 * feature is enabled and blob storage is enabled), or carry the raw bytes for
 * inline base64. On any upload failure this falls back to inline bytes so
 * image retrieval never hard-fails; the failure is logged as a warning so a
 * persistently broken blob storage configuration is observable.
 *
 * The `view-file-mode` feature gate governs the entire offload path: the URL
 * result and the Slack `_meta` block it carries (emitted in
 * `convertViewImageUrlToToolResult`) only exist on the `kind: 'url'` branch, so
 * disabling the flag keeps both behind the gate and preserves the original
 * inline-base64 behavior. The `isBlobStorageEnabled()` check keeps an enabled
 * flag without a configured provider on the inline path. A missing or invalid
 * tenant returns an error rather than falling back, so nothing is uploaded unscoped.
 */
export async function buildImageToolResult({
  imageData,
  format,
  resourceId,
  toolName,
  tenant,
}: {
  imageData: Buffer | string;
  format: 'PNG' | 'SVG' | undefined;
  resourceId: string;
  toolName: string;
  tenant: TenantIdentitySource;
}): Promise<Result<ImageToolResult, McpToolError>> {
  if (!isBlobStorageEnabled() || !(await getFeatureGate().isFeatureEnabled('view-file-mode'))) {
    return new Ok({ kind: 'inline', imageData, format });
  }

  const tenantLuids = getTenantLuids(tenant);
  if (tenantLuids.isErr()) {
    return tenantLuids;
  }

  try {
    const resolvedFormat = format ?? 'PNG';
    const { url } = await getBlobStorageProvider().upload({
      key: buildImageKey(tenantLuids.value, resourceId, resolvedFormat),
      ...toUploadData(imageData),
      contentType: contentTypeFor(resolvedFormat),
    });
    return new Ok({ kind: 'url', url, format });
  } catch (error) {
    // The full image buffer is still in hand, so we can always fall back to
    // inline base64. Log the key facts (never the URL / signature).
    log({
      message: `${toolName}: blob storage image upload failed, falling back to inline base64: ${getExceptionMessage(
        error,
      )}`,
      level: 'warning',
      logger: 'tool',
    });
    return new Ok({ kind: 'inline', imageData, format });
  }
}

/** Converts an {@link ImageToolResult} into the final MCP tool result. */
export function imageToolResultToCallToolResult(result: ImageToolResult): CallToolResult {
  return result.kind === 'url'
    ? convertViewImageUrlToToolResult(result.url, result.format)
    : convertViewImageToToolResult(result.imageData, result.format);
}
