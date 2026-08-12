/**
 * Sticky worksheet edit buffer — lets name-only add-field/remove-field calls accumulate
 * edits on one cache file instead of each minting a fresh (blank) fetch from the live
 * workbook. Diagnosed from chat 6b0b4355: five name-only add-field calls each fetched a
 * fresh sheet, so only the LAST edit survived to apply-worksheet.
 *
 * One pointer file per (session, worksheetName), stored under DesktopCache so it
 * survives an MCP process restart within the same Desktop session. The pointer is
 * intentionally the only source of truth for "is there an open edit buffer for this
 * sheet" — no in-memory map, since two server instances/restarts must see the same
 * state a Desktop-side edit would.
 */
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'fs';

import { DesktopCache } from '../../../../desktop/cache.js';
import { checkSidecar } from '../../../../desktop/wrappers/cacheFingerprint.js';
import { log } from '../../../../logging/logger.js';
import { safeWorksheetCacheId } from './worksheetCache.js';

interface WorksheetEditBufferPointer {
  file: string;
  session_id: string;
  worksheet_name: string;
  updated_at: string;
}

function pointerFilePath({
  session,
  worksheetName,
}: {
  session: string;
  worksheetName: string;
}): string {
  return new DesktopCache().getCacheFilePath({
    prefix: 'worksheet-edit-buffer',
    id: `${safeWorksheetCacheId(worksheetName)}-${safeWorksheetCacheId(session)}`,
    extension: 'json',
  });
}

/**
 * The sticky cache file for this sheet+session, or undefined if there is none, it is
 * unreadable, it points at a session that no longer matches, its target file is gone,
 * or the target file's own instance fingerprint no longer matches the current session
 * (same fail-open posture as {@link checkSidecar}: anything unresolved falls through to
 * a fresh fetch rather than blocking).
 */
export function getStickyWorksheetFile({
  session,
  worksheetName,
}: {
  session: string;
  worksheetName: string;
}): string | undefined {
  const trimmedName = worksheetName.trim();
  const pointerFile = pointerFilePath({ session, worksheetName: trimmedName });
  if (!existsSync(pointerFile)) {
    return undefined;
  }

  let pointer: Partial<WorksheetEditBufferPointer>;
  try {
    pointer = JSON.parse(readFileSync(pointerFile, 'utf-8')) as Partial<WorksheetEditBufferPointer>;
  } catch (error) {
    log({
      message: 'worksheet edit buffer pointer unreadable — starting a fresh buffer',
      level: 'warning',
      logger: 'worksheetEditBuffer',
      data: { pointerFile, error: String(error) },
    });
    return undefined;
  }

  if (
    typeof pointer.file !== 'string' ||
    typeof pointer.session_id !== 'string' ||
    typeof pointer.worksheet_name !== 'string'
  ) {
    return undefined;
  }
  // The pointer path is already keyed by session, but a session collision after
  // sanitization (two ids that sanitize to the same string) would otherwise bleed one
  // session's buffer into another's — checking the recorded session_id closes that gap.
  if (pointer.session_id !== session) {
    return undefined;
  }
  if (pointer.worksheet_name !== trimmedName) {
    return undefined;
  }
  if (!existsSync(pointer.file)) {
    return undefined;
  }

  const sidecarCheck = checkSidecar(pointer.file, session, 'worksheet');
  if (!sidecarCheck.ok) {
    return undefined;
  }

  return pointer.file;
}

/** Point the sticky buffer for this sheet+session at `file` (minted, reused, or caller-supplied). */
export function setStickyWorksheetFile({
  session,
  worksheetName,
  file,
}: {
  session: string;
  worksheetName: string;
  file: string;
}): void {
  const trimmedName = worksheetName.trim();
  const pointerFile = pointerFilePath({ session, worksheetName: trimmedName });
  const pointer: WorksheetEditBufferPointer = {
    file,
    session_id: session,
    worksheet_name: trimmedName,
    updated_at: new Date().toISOString(),
  };
  try {
    writeFileSync(pointerFile, JSON.stringify(pointer, null, 2), 'utf-8');
  } catch (error) {
    log({
      message: 'worksheet edit buffer pointer write failed',
      level: 'warning',
      logger: 'worksheetEditBuffer',
      data: { pointerFile, error: String(error) },
    });
  }
}

/**
 * Close the open edit buffer for this sheet+session — called after a successful
 * apply-worksheet (the edits landed; a later name-only call should start from a fresh
 * live read, not silently re-touch an already-applied file) and after an explicit
 * get-worksheet-xml re-read by name (the agent asked for live truth; treat that as the
 * new starting point rather than resuming the old buffer underneath it).
 */
export function clearStickyWorksheetFile({
  session,
  worksheetName,
}: {
  session: string;
  worksheetName: string;
}): void {
  const pointerFile = pointerFilePath({ session, worksheetName: worksheetName.trim() });
  if (!existsSync(pointerFile)) {
    return;
  }
  try {
    unlinkSync(pointerFile);
  } catch (error) {
    log({
      message: 'worksheet edit buffer pointer clear failed',
      level: 'warning',
      logger: 'worksheetEditBuffer',
      data: { pointerFile, error: String(error) },
    });
  }
}
