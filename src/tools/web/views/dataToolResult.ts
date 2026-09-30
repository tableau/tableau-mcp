import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { Config } from '../../../config.js';
import { getFeatureGate } from '../../../features/init.js';
import { log } from '../../../logging/logger.js';
import { getExceptionMessage } from '../../../utils/getExceptionMessage.js';
import { joinS3Prefix } from '../s3Client.js';
import { uploadCsvToS3 } from '../uploadDataToS3.js';

/**
 * Discriminated result carried from a data tool's `callback` to its
 * `getSuccessResult`. Either a presigned S3 URL (CSV offloaded) or the raw CSV
 * text (inline fallback).
 *
 * Note: this value is forwarded through `constrainSuccessResult` to
 * `getSuccessResult` only; it is never serialized into logs or telemetry, so
 * carrying the presigned URL here does not leak it into log output.
 */
export type DataToolResult = { kind: 'url'; url: string } | { kind: 'inline'; csv: string };

/**
 * Given a view's CSV data, either upload it to S3 and return a presigned URL
 * (when the `view-data-file-mode` feature is enabled and MCP_S3_BUCKET is
 * configured), or carry the raw CSV for an inline text result. On any S3
 * failure this falls back to inline CSV so data retrieval never hard-fails; the
 * failure is logged as a warning so a persistently broken S3 configuration is
 * observable.
 *
 * The `view-data-file-mode` feature gate governs the entire S3-offload path, so
 * disabling the flag keeps the presigned-URL result behind the gate and
 * preserves the original inline behavior. The `bucketS3.enabled` check still
 * guards against a missing bucket so an enabled flag without config doesn't
 * attempt a doomed upload on every request.
 *
 * `keyPrefixSegment` is the caller's per-tool folder (e.g. `view-data/`); it is
 * appended to the shared base prefix (MCP_IMAGE_PREFIX) so each tool namespaces
 * its objects distinctly while still honoring an operator-configured base.
 */
export async function buildDataToolResult({
  csv,
  resourceId,
  config,
  toolName,
  keyPrefixSegment,
}: {
  csv: string;
  resourceId: string;
  config: Config;
  toolName: string;
  keyPrefixSegment: string;
}): Promise<DataToolResult> {
  if (
    !config.bucketS3.enabled ||
    !(await getFeatureGate().isFeatureEnabled('view-data-file-mode'))
  ) {
    return { kind: 'inline', csv };
  }

  try {
    const url = await uploadCsvToS3(csv, {
      resourceId,
      config: {
        ...config.bucketS3,
        keyPrefix: joinS3Prefix(config.bucketS3.keyPrefix, keyPrefixSegment),
      },
    });
    return { kind: 'url', url };
  } catch (error) {
    // The full CSV is still in hand, so we can always fall back to inline. Log
    // the key facts (never the presigned URL / signature).
    log({
      message: `${toolName}: S3 CSV upload failed, falling back to inline data: ${getExceptionMessage(
        error,
      )}`,
      level: 'warning',
      logger: 'tool',
    });
    return { kind: 'inline', csv };
  }
}

/**
 * Converts a {@link DataToolResult} into the final MCP tool result.
 *
 * The inline branch emits `JSON.stringify(csv)` as a text block — byte-for-byte
 * identical to the tools' previous default output — so disabling the feature
 * preserves the original behavior exactly. The URL branch emits a single
 * `resource_link` block carrying the short-lived presigned URL; the client
 * fetches the CSV bytes directly from S3.
 */
export function dataToolResultToCallToolResult(result: DataToolResult): CallToolResult {
  if (result.kind === 'inline') {
    return {
      isError: false,
      content: [{ type: 'text', text: JSON.stringify(result.csv) }],
    };
  }

  return {
    isError: false,
    content: [
      {
        type: 'resource_link',
        uri: result.url,
        name: 'view-data.csv',
        mimeType: 'text/csv',
        description: 'View data (CSV) stored in S3. This is a short-lived presigned URL.',
      },
    ],
  };
}
