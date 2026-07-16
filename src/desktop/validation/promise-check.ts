/**
 * Promise check (W-23447506): a HOST-COMPUTED verification receipt appended to
 * apply-style responses, so the agent's narration is anchored to evidence the
 * server actually has — instead of the model inventing problems ("workbook
 * wiring issue") or confidence ("verified!") that nothing measured.
 *
 * Schema-decay rule: the model fills NOTHING here. Every field derives from
 * validation issues and readback verification already computed on the apply
 * path. Dashboard/whole-workbook intent is honestly labeled unverified — only
 * worksheet readback proves structural survival.
 *
 * Ported from agent-to-tableau-desktop.
 */
import type { ReadbackFinding, ReadbackVerificationResult } from './readback-verify.js';
import type { ValidationIssue } from './types.js';

export type PromiseOutcome = 'verified' | 'unverified' | 'failed';

export interface WorksheetReceiptInput {
  validationWarnings: ValidationIssue[];
  readback: ReadbackVerificationResult | undefined;
  /**
   * Readback findings for this apply (same list the warnings above render from).
   * Used to detect a PROMISED sort — a `<computed-sort>` present in the SUBMITTED
   * XML — that Tableau dropped or changed on readback. That is a claim failure
   * ("sorted descending" is exactly what was asked), NOT the incidental sort
   * drift the readback verifier otherwise treats as a warning, so it must not
   * ride out as "verified". (W66 item 4)
   */
  readbackFindings?: ReadbackFinding[];
}

/**
 * True when a readback finding proves a submitted `<computed-sort>` did not
 * survive intact. `verifyWorksheetReadback` only emits a sort finding for a sort
 * that was in the SUBMITTED XML, and stamps `node` with the sort tag — so a
 * `computed-sort` sort finding is definitionally "the promise had a computed-sort
 * and readback lost/changed it". A `shelf-sort-v2` (incidental) finding does not
 * qualify, and a submission with no sort produces no finding at all.
 */
function promisedSortNotVerified(findings: ReadbackFinding[] | undefined): boolean {
  return (findings ?? []).some((f) => f.kind === 'sort' && f.node === 'computed-sort');
}

function formatPreflight(validationWarnings: ValidationIssue[]): string {
  return validationWarnings.length === 0
    ? 'preflight clean'
    : `preflight ${validationWarnings.length} warning(s)`;
}

/** One compact line: outcome + the checks that back it + the claim guard. */
export function formatWorksheetPromiseCheck(input: WorksheetReceiptInput): string {
  const parts: string[] = [formatPreflight(input.validationWarnings), 'apply completed'];
  let outcome: PromiseOutcome;
  switch (input.readback?.status) {
    case 'passed':
      outcome = 'verified';
      parts.push('readback clean');
      break;
    case 'warning':
      outcome = 'verified';
      parts.push('readback warnings (listed above)');
      break;
    case 'failed':
      outcome = 'failed';
      parts.push('readback FAILED (nodes dropped)');
      break;
    case 'skipped':
    default:
      outcome = 'unverified';
      parts.push('readback unavailable');
      break;
  }
  // A `<computed-sort>` in the submitted XML is an explicit sort promise ("sorted
  // descending"). If readback shows it dropped/changed, the sort claim FAILED and
  // must never be labeled verified on the warning-status path (readback sort
  // discrepancies are warnings, and warnings otherwise map to verified). Incidental
  // drift — a submission with no `<computed-sort>`, or a non-promise shelf sort —
  // yields no qualifying finding and is left unchanged. (W66 item 4)
  if (outcome === 'verified' && promisedSortNotVerified(input.readbackFindings)) {
    outcome = 'failed';
    parts.push('promised sort NOT verified (computed-sort dropped/changed on readback)');
  }
  const guard =
    outcome === 'verified'
      ? ' No host evidence of any workbook problem beyond the findings listed above — do not report unlisted issues.'
      : ' Do not claim the change is confirmed; report only the evidence above.';
  return `\n\nHOST VERIFICATION — ${outcome}: ${parts.join(' · ')}.${guard}`;
}

/**
 * Whole-workbook applies have NO structural readback today — say so instead of
 * letting success text imply full verification.
 */
export function formatWorkbookPromiseCheck(validationWarnings: ValidationIssue[]): string {
  const parts = [
    formatPreflight(validationWarnings),
    'apply completed',
    'full workbook intent NOT re-verified',
  ];
  return `\n\nHOST VERIFICATION — unverified: ${parts.join(' · ')}. Treat sheet-level state as unconfirmed until read back; do not report problems without host evidence.`;
}

/** Dashboard applies likewise have no structural readback — honest by construction. */
export function formatDashboardPromiseCheck(validationWarnings: ValidationIssue[]): string {
  const parts = [
    formatPreflight(validationWarnings),
    'apply completed',
    'full dashboard intent NOT re-verified',
  ];
  return `\n\nHOST VERIFICATION — unverified: ${parts.join(' · ')}. Treat dashboard state as unconfirmed until read back; do not report problems without host evidence.`;
}
