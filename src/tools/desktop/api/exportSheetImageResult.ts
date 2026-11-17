import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { writeFileSync } from 'fs';
import { Result } from 'ts-results-es';

import { Config } from '../../../config.desktop.js';
import { DesktopCache } from '../../../desktop/cache.js';
import { ImageResult } from '../../../desktop/externalApi/types.js';
import {
  buildInlineImageCapFileMessage,
  imageExtensionForMimeType,
  inlineImageFootprintBytes,
  isOverInlineImageCap,
  logInlineImageCapHit,
} from '../../../desktop/limits/inlineImageCap.js';
import { ImageExportTimeoutError } from '../../../errors/mcpToolError.desktop.js';
import { McpToolError } from '../../../errors/mcpToolError.js';

type BuildSheetImageToolResultArgs = {
  /** Tool name for cap-hit audit logging. */
  tool: string;
  /** Human label for messages, e.g. `Worksheet` / `Dashboard`. */
  label: string;
  /** Cache-file prefix for file-mode and over-cap exports, e.g. `worksheet-image`. */
  cachePrefix: string;
  /** The Desktop image export envelope. */
  image: ImageResult;
  mode: 'file' | 'inline';
  config: Config;
};

type BuildCachedImageToolResultArgs = {
  tool: string;
  label: string;
  cachePrefix: string;
  bytes: Buffer;
  inlineBytes: number;
  capBytes: number;
  mimeType: string;
  nextStep?: string;
};

export function writeImageCacheFile({
  cachePrefix,
  bytes,
  mimeType,
}: {
  cachePrefix: string;
  bytes: Buffer;
  mimeType: string;
}): string {
  try {
    const cacheFile = new DesktopCache().getCacheFilePath({
      prefix: cachePrefix,
      extension: imageExtensionForMimeType(mimeType),
    });
    writeFileSync(cacheFile, bytes, { flag: 'wx', mode: 0o600 });
    return cacheFile;
  } catch {
    throw new Error('Could not write the image to the local cache.');
  }
}

export function buildCachedImageToolResult({
  tool,
  label,
  cachePrefix,
  bytes,
  inlineBytes,
  capBytes,
  mimeType,
  nextStep,
}: BuildCachedImageToolResultArgs): CallToolResult | undefined {
  if (!isOverInlineImageCap(inlineBytes, capBytes)) return undefined;

  const cacheFile = writeImageCacheFile({ cachePrefix, bytes, mimeType });
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
          nextStep,
        }),
      },
    ],
  };
}

function describeImageSize({ width, height }: ImageResult): string {
  if (width === undefined || height === undefined) {
    return '';
  }
  return width < 0 || height < 0
    ? ' (vector output; pixel size not applicable)'
    : ` (${width}x${height})`;
}

/**
 * Translates a Desktop image-export envelope into an MCP tool result.
 *
 * One branch per envelope shape Desktop emits:
 *   1. `filePath` present → Desktop persisted the image (caller passed a filePath); project
 *      the path (bytes are intentionally absent).
 *   2. `imageBase64` present, file mode → write the bytes to a cache file and return its path.
 *   3. `imageBase64` present, inline mode, under the inline cap → inline MCP image block. Real SVG also
 *      rides as a text block so clients that don't render an SVG image block still get the
 *      markup (mirrors the web image builder).
 *   4. `imageBase64` present, inline mode, over the cap → write the bytes to a cache file and return its
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
  mode,
  config,
}: BuildSheetImageToolResultArgs): CallToolResult {
  const dims = describeImageSize(image);

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
          text: `${label} image export returned neither image bytes nor a file path.`,
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

  if (mode !== 'inline') {
    const cacheFile = writeImageCacheFile({
      cachePrefix,
      bytes: decoded,
      mimeType: actualMimeType,
    });
    return {
      isError: false,
      content: [{ type: 'text', text: `${label} image saved to cache file: ${cacheFile}${dims}.` }],
    };
  }

  const capBytes = config.inlineImageMaxBytes;
  // Bytes that actually ride inline: raster is one base64 block, but SVG is dual-emitted
  // (decoded text + base64 image block), so it costs ~2x its decoded size.
  const inlineBytes = inlineImageFootprintBytes(decoded.length, actualMimeType);

  // (4) Over the cap: write the decoded bytes to a cache file and return its path.
  const cachedResult = buildCachedImageToolResult({
    tool,
    label,
    cachePrefix,
    bytes: decoded,
    inlineBytes,
    capBytes,
    mimeType: actualMimeType,
  });
  if (cachedResult) return cachedResult;

  // (3) Under the cap: inline image block. Real SVG also rides as a decoded text block.
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
 * Runs an image export under a deadline scoped to that export only. The first render after
 * Desktop launches can hang forever behind a modal dialog; this converts that into a reportable
 * timeout instead of an unbounded wait. `exportImage` must forward `combined` to the executor.
 *
 * Only when the timeout fired AND the request signal did not is the failure reported as
 * {@link ImageExportTimeoutError}; a cancelled request keeps its original error.
 */
export async function exportSheetImageWithDeadline({
  label,
  timeoutMs,
  signal,
  exportImage,
}: {
  label: string;
  timeoutMs: number;
  signal: AbortSignal;
  exportImage: (combined: AbortSignal) => Promise<Result<ImageResult, McpToolError>>;
}): Promise<Result<ImageResult, McpToolError>> {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const combined = AbortSignal.any([signal, timeoutSignal]);
  const imageResult = await exportImage(combined);
  if (imageResult.isErr() && timeoutSignal.aborted && !signal.aborted) {
    return new ImageExportTimeoutError(label, timeoutMs).toErr();
  }
  return imageResult;
}
