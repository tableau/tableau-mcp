import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { writeFileSync } from 'fs';
import { Result } from 'ts-results-es';

import { Config } from '../../../config.desktop.js';
import { DesktopCache } from '../../../desktop/cache.js';
import { ExecuteCommandError } from '../../../desktop/externalApi/executorTypes.js';
import { ExternalApiToolExecutor } from '../../../desktop/externalApi/externalApiToolExecutor.js';
import { ImageResult } from '../../../desktop/externalApi/types.js';
import {
  buildInlineImageCapFileMessage,
  imageExtensionForMimeType,
  inlineImageFootprintBytes,
  isOverInlineImageCap,
  logInlineImageCapHit,
} from '../../../desktop/limits/inlineImageCap.js';
import { ExternalApiRead } from '../../../desktop/wrappers/readHarness.js';
import { ImageExportTimeoutError, McpToolError } from '../../../errors/mcpToolError.js';

type BuildSheetImageToolResultArgs = {
  /** Tool name for cap-hit audit logging. */
  tool: string;
  /** Human label for messages, e.g. `Worksheet` / `Dashboard`. */
  label: string;
  /** Cache-file prefix used when the cap forces a file, e.g. `worksheet-image`. */
  cachePrefix: string;
  /** The Desktop image export envelope. */
  image: ImageResult;
  config: Config;
};

/**
 * Translates a Desktop image-export envelope into an MCP tool result.
 *
 * One branch per envelope shape Desktop emits:
 *   1. `filePath` present → Desktop persisted the image (caller passed a filePath); project
 *      the path (bytes are intentionally absent).
 *   2. `imageBase64` present, under the inline cap → inline MCP image block. Real SVG also
 *      rides as a text block so clients that don't render an SVG image block still get the
 *      markup (mirrors the web image builder).
 *   3. `imageBase64` present, over the cap → write the bytes to a cache file and return its
 *      path, keeping multi-megabyte images out of the conversation.
 *
 * The block is labelled SOLELY from `image.effectiveMimeType` — the server-declared ACTUAL
 * rendered format (post any server-side fallback), authoritative and case/whitespace-insensitive.
 * The render format is constrained to `image/png` or `image/svg+xml` , so SVG is emitted only when
 * the field is `image/svg+xml`; anything else — png, absent, or blank — is labelled `image/png`.
 */
export function buildSheetImageToolResult({
  tool,
  label,
  cachePrefix,
  image,
  config,
}: BuildSheetImageToolResultArgs): CallToolResult {
  const dims =
    image.width !== undefined && image.height !== undefined
      ? ` (${image.width}x${image.height})`
      : '';

  // (1) Desktop persisted the bytes (caller passed filePath); project the path.
  if (image.filePath) {
    return {
      isError: false,
      content: [{ type: 'text', text: `${label} image written to ${image.filePath}${dims}.` }],
    };
  }

  const imageBase64 = image.imageBase64;
  if (!imageBase64) {
    return {
      isError: true,
      content: [
        {
          type: 'text',
          text: `${label} image export returned neither image bytes nor a file path. Pass a filePath to have Tableau write the image to disk instead of returning it inline.`,
        },
      ],
    };
  }

  // Label SOLELY from the server-declared actual format. The render format is constrained to
  // image/png or image/svg+xml, so SVG only when the field says so (case/whitespace-insensitive);
  // anything else — png, absent, blank — is png. No byte-sniff fallback. All downstream
  // sizing/labelling uses this. The bytes are still decoded for the footprint calc and cache write.
  const decoded = Buffer.from(imageBase64, 'base64');
  const normalized = (image.effectiveMimeType ?? '').trim().toLowerCase();
  const actualMimeType = normalized === 'image/svg+xml' ? 'image/svg+xml' : 'image/png';

  const capBytes = config.inlineImageMaxBytes;
  // Bytes that actually ride inline: raster is one base64 block, but SVG is dual-emitted
  // (decoded text + base64 image block), so it costs ~2x its decoded size.
  const inlineBytes = inlineImageFootprintBytes(decoded.length, actualMimeType);

  // (3) Over the cap: write the decoded bytes to a cache file and return its path.
  if (isOverInlineImageCap(inlineBytes, capBytes)) {
    const cacheFile = new DesktopCache().getCacheFilePath({
      prefix: cachePrefix,
      extension: imageExtensionForMimeType(actualMimeType),
    });
    writeFileSync(cacheFile, decoded);
    logInlineImageCapHit({ tool, bytes: inlineBytes, capBytes, file: cacheFile });
    return {
      isError: false,
      content: [
        {
          type: 'text',
          text: buildInlineImageCapFileMessage({
            label,
            bytes: inlineBytes,
            capBytes,
            file: cacheFile,
          }),
        },
      ],
    };
  }

  // (2) Under the cap: inline image block. Real SVG also rides as a decoded text block.
  if (actualMimeType === 'image/svg+xml') {
    return {
      isError: false,
      content: [
        { type: 'text', text: decoded.toString('utf-8') },
        { type: 'image', data: imageBase64, mimeType: actualMimeType },
      ],
    };
  }

  return {
    isError: false,
    content: [{ type: 'image', data: imageBase64, mimeType: actualMimeType }],
  };
}

/**
 * Normalizes the optional `filePath` / `mimeType` args into a client query, dropping blank
 * strings so they read as absent (an empty filePath is a 400 on Desktop). `mimeType` forwards
 * the REQUESTED format to Desktop; the emitted label is derived separately from the response's
 * `effectiveMimeType`, not from this requested value.
 */
export function resolveImageExportQuery(args: { filePath?: string; mimeType?: string }): {
  query: { filePath?: string; mimeType?: string };
} {
  const filePath = args.filePath?.trim() || undefined;
  const mimeType = args.mimeType?.trim() || undefined;
  return {
    query: { filePath, mimeType },
  };
}

/**
 * Runs an image-render call under a deadline scoped to that call only (the sheet-list call that
 * precedes it rides `signal`, the request's own signal). The first render after Desktop launches
 * can hang forever behind a modal dialog; this converts that into a reportable timeout instead of
 * an unbounded wait. The harness `read()` always passes the request signal into the closure, so
 * `doExport` receives the `combined` signal explicitly and must forward it to the executor.
 *
 * A timeout is distinguished from a caller cancellation: only when the timeout fired AND the
 * request signal did not is the failure reported as {@link ImageExportTimeoutError}; a cancelled
 * request keeps its original error. Shared by the worksheet and dashboard export tools, whose only
 * differences are the label, endpoint name, and executor method.
 */
export async function exportSheetImageWithDeadline({
  label,
  endpoint,
  timeoutMs,
  signal,
  read,
  doExport,
}: {
  label: string;
  endpoint: string;
  timeoutMs: number;
  signal: AbortSignal;
  read: ExternalApiRead;
  doExport: (
    executor: ExternalApiToolExecutor,
    combined: AbortSignal,
  ) => Promise<Result<ImageResult, ExecuteCommandError>>;
}): Promise<Result<ImageResult, McpToolError>> {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const combined = AbortSignal.any([signal, timeoutSignal]);
  const imageResult = await read<ImageResult>(
    endpoint,
    async (executor) => await doExport(executor, combined),
  );
  if (imageResult.isErr() && timeoutSignal.aborted && !signal.aborted) {
    return new ImageExportTimeoutError(label, timeoutMs).toErr();
  }
  return imageResult;
}
