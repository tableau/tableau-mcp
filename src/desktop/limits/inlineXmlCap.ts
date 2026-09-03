import { log } from '../../logging/logger.js';
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
  documentNoun?: string;
  cacheSelector: string | null;
  bytes: number;
  capBytes: number;
  xml: string;
  applyTool: string;
  pathParam: string;
}): string {
  const {
    kind,
    label,
    documentNoun = 'XML',
    cacheSelector,
    bytes,
    capBytes,
    xml,
    applyTool,
    pathParam,
  } = params;
  const readGuidance = cacheSelector
    ? `pass a ${cacheSelector} selector, or startByte/endByte, to read just a slice`
    : 'pass startByte/endByte to read just a slice';
  const writeGuidance = cacheSelector
    ? 'the same selector splices your edit back into the file'
    : 'no worksheet/dashboard selector is needed';
  return [
    `${label} ${documentNoun} is ${bytes} bytes, over the ${capBytes}-byte inline cap. Returned in file mode ` +
      'regardless of the requested mode to keep large XML out of the conversation.',
    '',
    'Structural summary:',
    formatArtifactSummary(kind, xml),
    '',
    'Work with the cached file using the server tools (no local filesystem access needed): ' +
      `read-cached-xml (${readGuidance}), edit that slice, write-cached-xml (${writeGuidance}), ` +
      `then call ${applyTool} with ${pathParam} set to the returned file path.`,
  ].join('\n');
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
