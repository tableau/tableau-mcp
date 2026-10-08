import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok, Result } from 'ts-results-es';

import { Config } from '../../../config.js';
import { McpToolError } from '../../../errors/mcpToolError.js';
import { getFeatureGate } from '../../../features/init.js';
import { log } from '../../../logging/logger.js';
import { getExceptionMessage } from '../../../utils/getExceptionMessage.js';
import {
  convertViewImageToToolResult,
  convertViewImageUrlToToolResult,
} from '../convertViewImageToToolResult.js';
import { getTenantLuids, joinTenantS3Prefix, TenantIdentitySource } from '../s3Client.js';
import { uploadImageToS3 } from '../uploadImageToS3.js';

/**
 * Discriminated result carried from an image tool's `callback` to its
 * `getSuccessResult`. Either a presigned S3 URL (image offloaded) or the raw
 * image bytes (inline base64 fallback).
 *
 * Note: this value is forwarded through `constrainSuccessResult` to
 * `getSuccessResult` only; it is never serialized into logs or telemetry, so
 * carrying the presigned URL here does not leak it into log output.
 */
export type ImageToolResult =
  | { kind: 'url'; url: string; format: 'PNG' | 'SVG' | undefined }
  | { kind: 'inline'; imageData: Buffer | string; format: 'PNG' | 'SVG' | undefined };

/**
 * Given rendered image bytes, either upload them to S3 and return a presigned
 * URL (when the `view-file-mode` feature is enabled and MCP_S3_BUCKET is
 * configured), or carry the raw bytes for inline base64. On any S3 failure this
 * falls back to inline bytes so image retrieval never hard-fails; the failure is
 * logged as a warning so a persistently broken S3 configuration is observable.
 *
 * The `view-file-mode` feature gate governs the entire S3-offload path: the
 * presigned-URL result and the Slack `_meta` block it carries (emitted in
 * `convertViewImageUrlToToolResult`) only exist on the `kind: 'url'` branch, so
 * disabling the flag keeps both behind the gate and preserves the original
 * inline-base64 behavior. The `bucketS3.enabled` check still guards against a
 * missing bucket so an enabled flag without config doesn't attempt a doomed
 * upload on every request.
 *
 * `keyPrefixSegment` is the caller's per-tool folder (e.g. `view-images/`); it
 * is appended to the shared base prefix (MCP_IMAGE_PREFIX) and the caller's
 * `<siteLuid>/<userLuid>/` so each tool and tenant namespaces its objects
 * distinctly while still honoring an operator-configured base. A missing or
 * invalid tenant returns an error rather than falling back, so nothing is uploaded unscoped.
 */
export async function buildImageToolResult({
  imageData,
  format,
  resourceId,
  config,
  toolName,
  keyPrefixSegment,
  tenant,
}: {
  imageData: Buffer | string;
  format: 'PNG' | 'SVG' | undefined;
  resourceId: string;
  config: Config;
  toolName: string;
  keyPrefixSegment: string;
  tenant: TenantIdentitySource;
}): Promise<Result<ImageToolResult, McpToolError>> {
  if (!config.bucketS3.enabled || !(await getFeatureGate().isFeatureEnabled('view-file-mode'))) {
    return new Ok({ kind: 'inline', imageData, format });
  }

  const tenantLuids = getTenantLuids(tenant);
  if (tenantLuids.isErr()) {
    return tenantLuids;
  }
  const { siteLuid, userLuid } = tenantLuids.value;
  try {
    const url = await uploadImageToS3(imageData, {
      format: format ?? 'PNG',
      resourceId,
      config: {
        ...config.bucketS3,
        keyPrefix: joinTenantS3Prefix(
          config.bucketS3.keyPrefix,
          siteLuid,
          userLuid,
          keyPrefixSegment,
        ),
      },
    });
    return new Ok({ kind: 'url', url, format });
  } catch (error) {
    // The full image buffer is still in hand, so we can always fall back to
    // inline base64. Log the key facts (never the presigned URL / signature).
    log({
      message: `${toolName}: S3 image upload failed, falling back to inline base64: ${getExceptionMessage(
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
