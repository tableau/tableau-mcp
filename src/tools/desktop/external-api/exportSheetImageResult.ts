import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { writeFileSync } from 'fs';

import { Config } from '../../../config.desktop.js';
import { DesktopCache } from '../../../desktop/cache.js';
import { ImageResult } from '../../../desktop/externalApi/types.js';
import {
  buildInlineImageCapFileMessage,
  imageByteLength,
  imageExtensionForMimeType,
  inlineImageFootprintBytes,
  isOverInlineImageCap,
  logInlineImageCapHit,
} from '../../../desktop/inlineImageCap.js';

type BuildSheetImageToolResultArgs = {
  /** Tool name for cap-hit audit logging. */
  tool: string;
  /** Human label for messages, e.g. `Worksheet` / `Dashboard`. */
  label: string;
  /** Cache-file prefix used when the cap forces a file, e.g. `worksheet-image`. */
  cachePrefix: string;
  /** Effective image MIME type (requested, or `image/png` default) — labels the inline block. */
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
 *   2. `imageBase64` present, under the inline cap → inline MCP image block. SVG also rides
 *      as a text block so clients that don't render an SVG image block still get the markup
 *      (mirrors the web image builder).
 *   3. `imageBase64` present, over the cap → write the bytes to a cache file and return its
 *      path, keeping multi-megabyte images out of the conversation.
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
          text: `${label} image export returned neither image bytes nor a file path. This is unexpected — retry, or pass a filePath to have Tableau write the image to disk.`,
        },
      ],
    };
  }

  const capBytes = config.inlineImageMaxBytes;
  // Bytes that actually ride inline: raster is one base64 block, but SVG is dual-emitted
  // (decoded text + base64 image block), so it costs ~2x its decoded size.
  const inlineBytes = inlineImageFootprintBytes(imageByteLength(imageBase64), mimeType);

  // (3) Over the cap: write the decoded bytes to a cache file and return its path.
  if (isOverInlineImageCap(inlineBytes, capBytes)) {
    const cacheFile = new DesktopCache().getCacheFilePath({
      prefix: cachePrefix,
      extension: imageExtensionForMimeType(mimeType),
    });
    writeFileSync(cacheFile, Buffer.from(imageBase64, 'base64'));
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

  // (2) Under the cap: inline image block.
  if (mimeType === 'image/svg+xml') {
    return {
      isError: false,
      content: [
        { type: 'text', text: Buffer.from(imageBase64, 'base64').toString('utf-8') },
        { type: 'image', data: imageBase64, mimeType },
      ],
    };
  }

  return {
    isError: false,
    content: [{ type: 'image', data: imageBase64, mimeType }],
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
