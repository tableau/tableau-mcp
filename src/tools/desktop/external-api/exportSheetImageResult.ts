import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { writeFileSync } from 'fs';

import { Config } from '../../../config.desktop.js';
import { DesktopCache } from '../../../desktop/cache.js';
import { ImageResult } from '../../../desktop/externalApi/types.js';
import {
  buildInlineImageCapFileMessage,
  imageExtensionForMimeType,
  inlineImageFootprintBytes,
  isOverInlineImageCap,
  logInlineImageCapHit,
  sniffImageMimeType,
} from '../../../desktop/inlineImageCap.js';

type BuildSheetImageToolResultArgs = {
  /** Tool name for cap-hit audit logging. */
  tool: string;
  /** Human label for messages, e.g. `Worksheet` / `Dashboard`. */
  label: string;
  /** Cache-file prefix used when the cap forces a file, e.g. `worksheet-image`. */
  cachePrefix: string;
  /**
   * Requested image MIME type (from the request arg, or `image/png` default). Used only to
   * decide whether SVG was asked for; the block is labelled by the sniffed actual bytes, since
   * Desktop silently falls back to PNG when it declines an SVG render.
   */
  mimeType: string;
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
 * The bytes are sniffed rather than trusting the requested MIME type: Desktop silently falls
 * back to PNG when it declines an SVG render, so a declined-SVG sheet returns PNG bytes. The
 * cap footprint, file extension, and block label all key on the sniffed `actualMimeType`.
 */
export function buildSheetImageToolResult({
  tool,
  label,
  cachePrefix,
  mimeType,
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

  // Sniff the decoded bytes: Desktop silently returns PNG when it declines an SVG render, and
  // the response does not echo the format. Only emit SVG when the bytes truly are SVG AND the
  // caller asked for it; otherwise treat as PNG. All downstream sizing/labelling uses this.
  const decoded = Buffer.from(imageBase64, 'base64');
  const sniffed = sniffImageMimeType(decoded);
  const actualMimeType =
    mimeType === 'image/svg+xml' && sniffed === 'image/svg+xml' ? 'image/svg+xml' : 'image/png';

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
 * strings so they read as absent (an empty filePath is a 400 on Desktop). Also returns the
 * effective MIME type used to label the inline image block.
 */
export function resolveImageExportQuery(args: { filePath?: string; mimeType?: string }): {
  query: { filePath?: string; mimeType?: string };
  effectiveMimeType: string;
} {
  const filePath = args.filePath?.trim() || undefined;
  const mimeType = args.mimeType?.trim() || undefined;
  return {
    query: { filePath, mimeType },
    effectiveMimeType: mimeType ?? 'image/png',
  };
}
