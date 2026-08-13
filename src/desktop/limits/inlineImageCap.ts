import { log } from '../../logging/logger.js';

// Ceiling on the encoded image payload that may ride inline in a tool result. The 768 KiB
// default leaves 256 KiB for MCP JSON framing and surrounding tool content before TAS's 1 MiB
// message limit. Above it, export-image writes the image to a cache file and returns its path.
// Env-overridable via INLINE_IMAGE_MAX_BYTES.
export const DEFAULT_INLINE_IMAGE_MAX_BYTES = 768 * 1024;

// Deadline (ms) applied to the image-render call only (not the sheet-list call that precedes
// it). The first image call after Desktop launches can hang forever when Desktop is showing a
// modal dialog that blocks rendering; this bounds that hang into a reportable timeout error.
// Default for config.desktop.ts `imageExportTimeoutMs` (env-overridable via IMAGE_EXPORT_TIMEOUT_MS).
export const DEFAULT_IMAGE_EXPORT_TIMEOUT_MS = 30_000;

/** True when the image exceeds the cap. Equal-to-cap stays under (inclusive floor). */
export function isOverInlineImageCap(bytes: number, capBytes: number): boolean {
  return bytes > capBytes;
}

/**
 * Encoded payload bytes that actually ride inline for a given MIME type. Base64 is ASCII, so
 * its string length is its emitted byte length. SVG is dual-emitted as JSON-escaped decoded
 * text and as a base64 image block, so its footprint includes both representations.
 */
export function inlineImageFootprintBytes(
  imageBase64: string,
  mimeType: string | undefined,
  serializedTextBytes = 0,
): number {
  return imageBase64.length + (mimeType === 'image/svg+xml' ? serializedTextBytes : 0);
}

/** Cache-file extension for an image MIME type. Everything non-SVG is written as `.png`. */
export function imageExtensionForMimeType(mimeType: string | undefined): 'png' | 'svg' {
  return mimeType === 'image/svg+xml' ? 'svg' : 'png';
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
