import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { Config } from '../../../config.js';
import { log } from '../../../logging/logger.js';
import { getExceptionMessage } from '../../../utils/getExceptionMessage.js';
import {
  convertViewImageToToolResult,
  convertViewImageUrlToToolResult,
} from '../convertViewImageToToolResult.js';
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
 * URL (when IMAGE_S3_BUCKET is configured), or carry the raw bytes for inline
 * base64. On any S3 failure this falls back to inline bytes so image retrieval
 * never hard-fails; the failure is logged as a warning so a persistently broken
 * S3 configuration is observable.
 */
export async function buildImageToolResult({
  imageData,
  format,
  resourceId,
  config,
  toolName,
}: {
  imageData: Buffer | string;
  format: 'PNG' | 'SVG' | undefined;
  resourceId: string;
  config: Config;
  toolName: string;
}): Promise<ImageToolResult> {
  if (!config.imageS3.enabled) {
    return { kind: 'inline', imageData, format };
  }

  try {
    const url = await uploadImageToS3(imageData, {
      format: format ?? 'PNG',
      resourceId,
      config: config.imageS3,
    });
    return { kind: 'url', url, format };
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
    return { kind: 'inline', imageData, format };
  }
}

/** Converts an {@link ImageToolResult} into the final MCP tool result. */
export function imageToolResultToCallToolResult(result: ImageToolResult): CallToolResult {
  return result.kind === 'url'
    ? convertViewImageUrlToToolResult(result.url, result.format)
    : convertViewImageToToolResult(result.imageData, result.format);
}
