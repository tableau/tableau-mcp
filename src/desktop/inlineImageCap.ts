import { log } from '../logging/logger.js';

// Ceiling on decoded image bytes that may ride inline (as a base64 MCP image block) in a
// tool result. Above it, the export-image tools write the image to a cache file and return
// its path, keeping multi-megabyte dashboard PNGs out of the conversation. Default for
// config.desktop.ts `inlineImageMaxBytes` (env-overridable via INLINE_IMAGE_MAX_BYTES).
export const DEFAULT_INLINE_IMAGE_MAX_BYTES = 1024 * 1024;

// Deadline (ms) applied to the image-render call only (not the sheet-list call that precedes
// it). The first image call after Desktop launches can hang forever when Desktop is showing a
// modal dialog that blocks rendering; this bounds that hang into a reportable timeout error.
// Default for config.desktop.ts `imageExportTimeoutMs` (env-overridable via IMAGE_EXPORT_TIMEOUT_MS).
export const DEFAULT_IMAGE_EXPORT_TIMEOUT_MS = 30_000;

/** Decoded byte length of a base64 payload (the on-disk / on-wire image size). */
export function imageByteLength(imageBase64: string): number {
  return Buffer.from(imageBase64, 'base64').length;
}

/** True when the image exceeds the cap. Equal-to-cap stays under (inclusive floor). */
export function isOverInlineImageCap(bytes: number, capBytes: number): boolean {
  return bytes > capBytes;
}

/**
 * Decoded image bytes that actually ride inline for a given MIME type. Raster formats emit
 * one base64 block, so the footprint equals the decoded size. SVG is dual-emitted — once as
 * a decoded text block AND once as a base64 image block (mirrors the web image builder) — so
 * it puts ~2x its decoded size into the conversation. Capping on this keeps the "large images
 * out of the conversation" invariant honest for SVG instead of undercounting by half.
 */
export function inlineImageFootprintBytes(bytes: number, mimeType: string | undefined): number {
  return mimeType === 'image/svg+xml' ? bytes * 2 : bytes;
}

/** Cache-file extension for an image MIME type. Everything non-SVG is written as `.png`. */
export function imageExtensionForMimeType(mimeType: string | undefined): 'png' | 'svg' {
  return mimeType === 'image/svg+xml' ? 'svg' : 'png';
}

/**
 * Sniffs decoded image bytes and returns the MIME type they actually are. The /v0 image
 * contract silently falls back to `image/png` when an SVG render is declined and does NOT
 * echo the format, so trusting the requested MIME type would decode PNG-as-UTF8 and mislabel
 * the block. Only reports `image/svg+xml` when the bytes truly look like SVG/XML; everything
 * else is treated as `image/png`.
 */
export function sniffImageMimeType(bytes: Buffer): 'image/png' | 'image/svg+xml' {
  // PNG signature: 89 50 4E 47 0D 0A 1A 0A (check the leading 89 50 4E 47 = "\x89PNG").
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return 'image/png';
  }

  // SVG/XML: after an optional UTF-8 BOM and leading whitespace, starts with "<svg" or "<?xml".
  let text = bytes.toString('utf-8');
  if (text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1);
  }
  const trimmed = text.replace(/^\s+/, '');
  if (trimmed.startsWith('<svg') || trimmed.startsWith('<?xml')) {
    return 'image/svg+xml';
  }

  return 'image/png';
}

/**
 * Message returned by an export-image tool when the cap forced inline → file. Carries the
 * size-vs-cap reason and the file path so a client can open it.
 */
export function buildInlineImageCapFileMessage(params: {
  label: string;
  bytes: number;
  capBytes: number;
  file: string;
}): string {
  const { label, bytes, capBytes, file } = params;
  return [
    `${label} image is ${bytes} bytes, over the ${capBytes}-byte inline cap. Written to a file ` +
      'instead of returned inline to keep large images out of the conversation.',
    '',
    `Image file: ${file}`,
    '',
    'Open the file to view the image. To get a smaller inline image next time, request a ' +
      'worksheet instead of a whole dashboard, or pass a filePath to have Tableau write the ' +
      'image directly to a location of your choosing.',
  ].join('\n');
}

/**
 * Logs a cap-hit for session auditing. `capHit: true` is the greppable audit marker (shared
 * with the XML cap).
 */
export function logInlineImageCapHit(params: {
  tool: string;
  bytes: number;
  capBytes: number;
  file: string;
}): void {
  const { tool, bytes, capBytes, file } = params;
  log({
    message: `Inline image cap exceeded (${bytes} > ${capBytes} bytes): ${tool} returned file mode`,
    level: 'warning',
    logger: 'tool',
    data: { capHit: true, tool, bytes, capBytes, file },
  });
}
