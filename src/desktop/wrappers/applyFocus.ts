import { log } from '../../logging/logger.js';
import type { WithExecutorAndAbortSignal } from '../externalApi/executorTypes.js';
import { normalizeArray, parseXML } from '../metadata/parser.js';
import type { ParsedWindow, ParsedWorkbook } from '../metadata/types.js';
import { activateSheetValidated } from './activateSheet.js';

/**
 * Where the view belongs once this write lands.
 *
 * A whole-document POST always moves the view — Tableau picks the destination itself and
 * ignores the window flags we post (live probe 2026-07-25: three content-only applies from
 * three different sheets all ended on the same dashboard; the posted `maximized` flag was
 * accepted and ignored 4 of 4). So every write states its verdict: the artifact it produced,
 * the sheet the user was on before we posted, or nothing because a later write in the same
 * call names the place. The argument is required so a new call site cannot skip the question.
 */
export type ApplyFocus =
  | { navigate: 'artifact'; sheetName: string }
  | { navigate: 'restore' }
  | { navigate: 'none'; reason: 'intermediate-leg' | 'no-live-write' };

/**
 * The window the user is looking at, read from a workbook document. Tableau marks it
 * `maximized`; older documents also carry `active`. Used on the outgoing document to
 * recover the pre-apply sheet for a restore — free, because every write path builds that
 * document from a live read.
 */
export function activeWindowName(workbookXml: string): string | undefined {
  let workbook: ParsedWorkbook;
  try {
    workbook = parseXML(workbookXml);
  } catch {
    return undefined;
  }

  return normalizeArray<ParsedWindow>(workbook.workbook?.windows?.window).find(
    (window) =>
      typeof window['@_name'] === 'string' &&
      ['worksheet', 'dashboard'].includes(String(window['@_class'])) &&
      (window['@_active'] === 'true' || window['@_maximized'] === 'true'),
  )?.['@_name'];
}

function focusTarget(focus: ApplyFocus, postedXml: string): string | undefined {
  switch (focus.navigate) {
    case 'none':
      return undefined;
    case 'artifact':
      return focus.sheetName.trim() || undefined;
    case 'restore':
      return activeWindowName(postedXml);
  }
}

function logFocusEvent(
  sheetName: string,
  message: string,
  data: Record<string, unknown> = {},
): void {
  try {
    log({ level: 'warning', message, logger: 'workbookCommands', data: { sheetName, ...data } });
  } catch {
    // Navigation diagnostics must never change the completed apply result.
  }
}

/**
 * Move the view after a completed whole-document write. Best-effort by construction: the
 * apply already landed, so nothing here can fail the caller's result. The name is validated
 * against a fresh read before dispatch — a goto-sheet with a name Tableau does not know
 * returns FAILED *and* pops a blocking modal that wedges the next call.
 */
export async function dispatchApplyFocus({
  focus,
  postedXml,
  executor,
  signal,
}: {
  focus: ApplyFocus;
  postedXml: string;
} & WithExecutorAndAbortSignal): Promise<void> {
  const target = focusTarget(focus, postedXml);
  if (target === undefined) {
    if (focus.navigate === 'restore') {
      logFocusEvent('', 'Restore focus skipped; the posted document names no active window');
    }
    return;
  }

  try {
    const activation = await activateSheetValidated({ sheetName: target, executor, signal });
    switch (activation.status) {
      case 'activated':
        // Verify and reissue once. A second validated pass reads the document back: if the
        // goto landed, the already-active check skips and this costs one read; if it did not,
        // the same pass reissues. No sleep — 12 of 12 zero-sleep apply/goto/readback trials
        // came back settled, so Desktop serialises this for us.
        await activateSheetValidated({ sheetName: target, executor, signal });
        return;
      case 'already-active':
        return;
      case 'not-found':
        logFocusEvent(target, 'Focus skipped; target is absent from the post-apply workbook read', {
          availableSheets: activation.availableSheets,
        });
        return;
      case 'parse-failed':
        logFocusEvent(target, 'Focus skipped; could not parse the post-apply workbook read', {
          message: activation.message,
        });
        return;
      case 'read-failed':
        logFocusEvent(target, 'Focus skipped; could not re-read the applied workbook', {
          error: activation.error,
        });
        return;
      case 'command-failed':
        logFocusEvent(target, 'goto-sheet failed; the apply itself remains successful', {
          error: activation.error,
        });
        return;
    }
  } catch (error) {
    logFocusEvent(target, 'Focus threw; the apply itself remains successful', { error });
  }
}
