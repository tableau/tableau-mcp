import { writeFileSync } from 'fs';
import { Ok } from 'ts-results-es';

import { DesktopCache } from '../../../desktop/cache.js';
import { ArtifactKind, formatArtifactSummary } from '../../../desktop/limits/artifactSummary.js';
import {
  buildInlineCapFileMessage,
  isOverInlineXmlCap,
  logInlineXmlCapHit,
  xmlByteLength,
} from '../../../desktop/limits/inlineXmlCap.js';
import { writeSidecar } from '../../../desktop/wrappers/cacheFingerprint.js';
import { log } from '../../../logging/logger.js';

type XmlReadKind = 'workbook' | 'worksheet' | 'dashboard' | 'storyboard';

// What the fetched document is called in prose: workbook/worksheet reads return
// "content", a dashboard read returns its "layout", a storyboard read its "document".
const DOC_NOUN: Record<XmlReadKind, string> = {
  workbook: 'content',
  worksheet: 'content',
  dashboard: 'layout',
  storyboard: 'document',
};

export type XmlReadFileResult = { message: string; file: string; instructions: string };

/**
 * Shared post-fetch pipeline for the get-*-xml tools: byte-count against the inline cap,
 * inline early-return, cache write + session sidecar, cap-fired downgrade message, log,
 * and the artifact-summary Ok. The tools keep their own fetch and error mapping.
 */
export function finishXmlRead<K extends string>({
  kind,
  artifactKind,
  label,
  inlineKey,
  toolName,
  applyTool,
  pathParam,
  cacheName,
  xml,
  mode,
  capBytes,
  resolvedSession,
}: {
  kind: XmlReadKind;
  /** ArtifactKind for the structural summary; may differ from `kind` (storyboard). */
  artifactKind: ArtifactKind;
  /** Display label for messages, e.g. 'Workbook' or 'Worksheet "Sales"'. */
  label: string;
  /** Key the XML rides under in an inline result, e.g. 'workbookXml'. */
  inlineKey: K;
  toolName: string;
  applyTool: string;
  pathParam: string;
  /** Artifact name folded into the cache-file prefix; omit for the whole workbook. */
  cacheName?: string;
  xml: string;
  mode: 'file' | 'inline';
  capBytes: number;
  resolvedSession: string;
}): Ok<({ message: string } & Record<K, string>) | XmlReadFileResult> {
  const bytes = xmlByteLength(xml);
  // Server-enforced cap: inline requests over the cap are downgraded to file mode
  // so ~40KB documents never ride in the conversation (the measured token sink).
  const capFired = mode === 'inline' && isOverInlineXmlCap(bytes, capBytes);

  if (mode === 'inline' && !capFired) {
    return new Ok({
      message: `${capitalize(kind)} ${DOC_NOUN[kind]} returned inline (${bytes} bytes)`,
      ...({ [inlineKey]: xml } as Record<K, string>),
    });
  }

  // Save to cache file (requested file mode, or forced by the cap).
  const cacheFile = new DesktopCache().getCacheFilePath({
    prefix: cacheName === undefined ? kind : `${kind}-${cacheName.replace(/[^a-zA-Z0-9]/g, '_')}`,
  });
  writeFileSync(cacheFile, xml, 'utf-8');
  // Stamp the producing session so the apply tool can refuse a cache from a
  // different (or restarted) Desktop instance — cross-instance bleed guard (W9).
  writeSidecar(cacheFile, resolvedSession);

  if (capFired) {
    logInlineXmlCapHit({ tool: toolName, bytes, capBytes, file: cacheFile });
    // The cache read/write selector vocabulary: a workbook slices by contained sheet
    // kinds; the per-sheet documents slice by their own (a storyboard is a dashboard).
    const selector = artifactKind === 'workbook' ? 'worksheet/dashboard' : artifactKind;
    return new Ok({
      message: buildInlineCapFileMessage({
        kind: artifactKind,
        label,
        bytes,
        capBytes,
        xml,
        applyTool,
        pathParam,
      }),
      file: cacheFile,
      instructions:
        `This ${kind} exceeds the inline cap. Use the cache read tool (with a ${selector} ` +
        'selector or startByte/endByte to read a slice), the cache write tool (same selector to ' +
        `splice edits back), then call ${applyTool} with ${pathParam} set to this file path.`,
    });
  }

  log({
    message: `Saved ${kind} ${DOC_NOUN[kind]} to cache file: ${cacheFile}`,
    level: 'info',
    logger: 'tool',
    data: { file: cacheFile, size: bytes },
  });

  return new Ok({
    message: `${label} saved to cache file (${bytes} bytes)\n\nArtifact summary:\n${formatArtifactSummary(artifactKind, xml)}`,
    file: cacheFile,
    instructions: `Use this file path with ${applyTool} instead of passing content directly.`,
  });
}

function capitalize(kind: XmlReadKind): string {
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}
