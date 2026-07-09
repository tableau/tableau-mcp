import { log } from '../logging/logger.js';
import { ArtifactKind, formatArtifactSummary } from './artifactSummary.js';

// Server-enforced ceiling on how much workbook/worksheet/dashboard XML may ride
// inline in a tool result. Above this the get-*-xml tools respond in file mode
// regardless of the requested mode, keeping ~40KB documents out of the conversation
// (measured: inline XML on every get/apply round-trip burned millions of context
// tokens). The value is one place (config.desktop.ts `inlineXmlMaxBytes`,
// env-overridable via INLINE_XML_MAX_BYTES); this constant is its default.
export const DEFAULT_INLINE_XML_MAX_BYTES = 16 * 1024;

/** UTF-8 byte length of an XML string (not JS string length / code units). */
export function xmlByteLength(xml: string): number {
  return Buffer.byteLength(xml, 'utf8');
}

/** True when the payload exceeds the cap. Equal-to-cap stays under (inclusive floor). */
export function isOverInlineXmlCap(bytes: number, capBytes: number): boolean {
  return bytes > capBytes;
}

/**
 * Message returned by a get-*-xml tool when the cap forced inline → file. Carries the
 * reason (size vs cap), a compact structural summary, and a one-line how-to that works
 * for a client with NO local filesystem access (server cache tools only).
 */
export function buildInlineCapFileMessage(params: {
  kind: ArtifactKind;
  label: string;
  bytes: number;
  capBytes: number;
  xml: string;
}): string {
  const { kind, label, bytes, capBytes, xml } = params;
  return [
    `${label} XML is ${bytes} bytes, over the ${capBytes}-byte inline cap. Returned in file mode ` +
      'regardless of the requested mode to keep large XML out of the conversation.',
    '',
    'Structural summary:',
    formatArtifactSummary(kind, xml),
    '',
    'Work with the cached file using the server tools (no local filesystem access needed): ' +
      'read-cached-xml (pass a worksheet/dashboard selector, or startByte/endByte, to read just a ' +
      'slice), edit that slice, write-cached-xml (same selector splices your edit back into the ' +
      'file), then apply-* with mode=file.',
  ].join('\n');
}

/**
 * Note appended to a successful over-cap inline apply. Applies are never rejected on
 * size — a rejected apply after the agent already spent the tokens helps nobody — so
 * this only points at the cheaper file-mode workflow for next time.
 */
export function buildApplyOverCapNote(bytes: number, capBytes: number): string {
  return (
    `Note: the inline XML you sent was ${bytes} bytes, over the ${capBytes}-byte inline cap. It was ` +
    'applied, but next time prefer mode=file to keep large XML out of the conversation: get-*-xml ' +
    'writes a cache file, edit it via read-cached-xml/write-cached-xml (slice selectors keep payloads ' +
    'small), then apply-* with mode=file.'
  );
}

/**
 * Receipt for a cap-hit so sessions can be audited. Uses the existing structured-logging
 * idiom; `capHit: true` is the greppable audit marker.
 */
export function logInlineXmlCapHit(params: {
  tool: string;
  bytes: number;
  capBytes: number;
  file: string;
}): void {
  const { tool, bytes, capBytes, file } = params;
  log({
    message: `Inline XML cap exceeded (${bytes} > ${capBytes} bytes): ${tool} returned file mode`,
    level: 'warning',
    logger: 'tool',
    data: { capHit: true, tool, bytes, capBytes, file },
  });
}
