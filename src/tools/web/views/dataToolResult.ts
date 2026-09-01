import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { getBlobStorageProvider, isBlobStorageEnabled } from '../../../blobStorage/init.js';
import { getFeatureGate } from '../../../features/init.js';
import { log } from '../../../logging/logger.js';
import { getExceptionMessage } from '../../../utils/getExceptionMessage.js';

// CSV is uploaded as UTF-8 text. The charset is spelled out so clients that
// honor it decode the object correctly.
const CSV_CONTENT_TYPE = 'text/csv; charset=utf-8';

/**
 * Discriminated result carried from a data tool's `callback` to its
 * `getSuccessResult`. Either a URL (CSV offloaded to blob storage) or the raw
 * CSV text (inline fallback).
 *
 * Note: this value is forwarded through `constrainSuccessResult` to
 * `getSuccessResult` only; it is never serialized into logs or telemetry, so
 * carrying the URL here does not leak it into log output.
 */
export type DataToolResult = { kind: 'url'; url: string } | { kind: 'inline'; csv: string };

/**
 * Builds the blob storage key for a view's CSV data. Namespacing/prefixing
 * beyond this logical key (e.g. an operator-configured base path) is the
 * custom provider's own concern.
 */
function buildDataKey(resourceId: string): string {
  return `data/${resourceId}.csv`;
}

/**
 * Given a view's CSV data, either upload it via the configured
 * {@link BlobStorageProvider} and return a URL (when the `view-data-file-mode`
 * feature is enabled and blob storage is enabled), or carry the raw CSV for an
 * inline text result. On any upload failure this falls back to inline CSV so
 * data retrieval never hard-fails; the failure is logged as a warning so a
 * persistently broken blob storage configuration is observable.
 *
 * The `view-data-file-mode` feature gate governs the entire offload path, so
 * disabling the flag keeps the URL result behind the gate and preserves the
 * original inline behavior. The `isBlobStorageEnabled()` check still guards
 * against a noop/unconfigured provider so an enabled flag without a custom
 * provider doesn't attempt a doomed upload on every request.
 */
export async function buildDataToolResult({
  csv,
  resourceId,
  toolName,
}: {
  csv: string;
  resourceId: string;
  toolName: string;
}): Promise<DataToolResult> {
  if (
    !isBlobStorageEnabled() ||
    !(await getFeatureGate().isFeatureEnabled('view-data-file-mode'))
  ) {
    return { kind: 'inline', csv };
  }

  try {
    const { url } = await getBlobStorageProvider().upload({
      key: buildDataKey(resourceId),
      data: Buffer.from(csv, 'utf-8'),
      contentType: CSV_CONTENT_TYPE,
    });
    return { kind: 'url', url };
  } catch (error) {
    // The full CSV is still in hand, so we can always fall back to inline. Log
    // the key facts (never the URL / signature).
    log({
      message: `${toolName}: blob storage CSV upload failed, falling back to inline data: ${getExceptionMessage(
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
 * `resource_link` block carrying the URL; the client fetches the CSV bytes
 * directly from blob storage.
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
        description: 'View data (CSV) stored in blob storage.',
      },
    ],
  };
}
