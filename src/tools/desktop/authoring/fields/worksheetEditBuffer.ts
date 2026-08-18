/**
 * Sticky worksheet edit buffer — lets add-field/remove-field calls that name a sheet
 * accumulate edits on one cache file instead of each minting a fresh (blank) fetch from
 * the live workbook. Without it, five name-only add-field calls each fetched a fresh
 * sheet, so only the LAST edit survived to apply-worksheet.
 *
 * Keyed by `worksheetId` — the sheet's `<simple-id uuid>`, which is also the id the
 * External Client API addresses the live sheet by. Display names are never the key: a
 * rename would strand the buffer, and two sheets can transiently share a name mid-edit.
 * Callers resolve the id before opening the buffer.
 *
 * One pointer file per (session, worksheetId), stored under DesktopCache so it survives
 * an MCP process restart within the same Desktop session. The pointer is intentionally
 * the only source of truth for "is there an open edit buffer for this sheet" — no
 * in-memory map, since two server instances/restarts must see the same state a
 * Desktop-side edit would.
 */
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'fs';
import { Err, Ok, Result } from 'ts-results-es';

import { DesktopCache } from '../../../../desktop/cache.js';
import { checkSidecar } from '../../../../desktop/wrappers/cacheFingerprint.js';
import {
  ArgsValidationError,
  FileNotFoundError,
  McpToolError,
} from '../../../../errors/mcpToolError.js';
import { log } from '../../../../logging/logger.js';
import { TableauDesktopRequestHandlerExtra } from '../../toolContext.js';
import {
  fetchAndCacheWorksheet,
  resolveWorksheetBufferId,
  safeWorksheetCacheId,
} from './worksheetCache.js';

interface WorksheetEditBufferPointer {
  file: string;
  session_id: string;
  worksheet_id: string;
  updated_at: string;
}

function pointerFilePath({
  session,
  worksheetId,
}: {
  session: string;
  worksheetId: string;
}): string {
  return new DesktopCache().getCacheFilePath({
    prefix: 'worksheet-edit-buffer',
    id: `${safeWorksheetCacheId(worksheetId)}-${safeWorksheetCacheId(session)}`,
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
  worksheetId,
}: {
  session: string;
  worksheetId: string;
}): string | undefined {
  const trimmedId = worksheetId.trim();
  const pointerFile = pointerFilePath({ session, worksheetId: trimmedId });
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
    typeof pointer.worksheet_id !== 'string'
  ) {
    return undefined;
  }
  // The pointer path is already keyed by session, but a session collision after
  // sanitization (two ids that sanitize to the same string) would otherwise bleed one
  // session's buffer into another's — checking the recorded session_id closes that gap.
  if (pointer.session_id !== session) {
    return undefined;
  }
  if (pointer.worksheet_id !== trimmedId) {
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
  worksheetId,
  file,
}: {
  session: string;
  worksheetId: string;
  file: string;
}): void {
  const trimmedId = worksheetId.trim();
  const pointerFile = pointerFilePath({ session, worksheetId: trimmedId });
  const pointer: WorksheetEditBufferPointer = {
    file,
    session_id: session,
    worksheet_id: trimmedId,
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
  worksheetId,
}: {
  session: string;
  worksheetId: string;
}): void {
  const pointerFile = pointerFilePath({ session, worksheetId: worksheetId.trim() });
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

/**
 * The cache file add-field/remove-field should edit for this sheet+session, minting one from
 * a live fetch when no buffer is open. Resolves a worksheetName through the sheet's stable id
 * so a rename cannot strand the buffer, and updates the buffer pointer to the returned file.
 */
export async function resolveWorksheetEditFile({
  worksheetName,
  worksheetFile,
  resolvedSession,
  extra,
}: {
  worksheetName: string | undefined;
  worksheetFile: string | undefined;
  resolvedSession: string;
  extra: TableauDesktopRequestHandlerExtra;
}): Promise<Result<string, McpToolError>> {
  if (!worksheetFile?.trim() && !worksheetName?.trim()) {
    return Err(
      new ArgsValidationError(
        'Provide either worksheetName (to edit an existing sheet) or worksheetFile (a cached path).',
      ),
    );
  }

  const trimmedWorksheetName = worksheetName?.trim() || undefined;

  let bufferWorksheetId: string | undefined;
  if (trimmedWorksheetName) {
    const resolved = await resolveWorksheetBufferId({
      worksheetRef: trimmedWorksheetName,
      resolvedSession,
      extra,
    });
    if (resolved.isErr()) {
      return Err(resolved.error);
    }
    bufferWorksheetId = resolved.value;
  }

  let resolvedFile = worksheetFile?.trim() || undefined;
  if (!resolvedFile) {
    const sticky = getStickyWorksheetFile({
      session: resolvedSession,
      worksheetId: bufferWorksheetId!,
    });
    if (sticky) {
      resolvedFile = sticky;
    } else {
      const minted = await fetchAndCacheWorksheet({
        worksheetName: trimmedWorksheetName!,
        resolvedSession,
        extra,
      });
      if (minted.isErr()) {
        return Err(minted.error);
      }
      resolvedFile = minted.value;
    }
  }

  if (bufferWorksheetId) {
    setStickyWorksheetFile({
      session: resolvedSession,
      worksheetId: bufferWorksheetId,
      file: resolvedFile,
    });
  }

  if (!existsSync(resolvedFile)) {
    return Err(new FileNotFoundError(resolvedFile));
  }

  return Ok(resolvedFile);
}
