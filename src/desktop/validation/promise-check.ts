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
import type { ExecuteCommandWarning } from '../externalApi/executorTypes.js';
import {
  isPromisedSortLossWarning,
  type ReadbackFinding,
  type ReadbackVerificationResult,
} from './readback-verify.js';
import type { ValidationIssue } from './types.js';

export type PromiseOutcome = 'verified' | 'unverified' | 'failed';

export interface WorksheetReceiptInput {
  validationWarnings: ValidationIssue[];
  readback: ReadbackVerificationResult | undefined;
  readbackFindings?: ReadbackFinding[];
}

function formatPreflight(validationWarnings: ValidationIssue[]): string {
  return validationWarnings.length === 0
    ? 'preflight clean'
    : `preflight ${validationWarnings.length} warning(s)`;
}

/** One compact line: outcome + the checks that back it + the claim guard. */
export function classifyWorksheetPromiseOutcome(input: WorksheetReceiptInput): PromiseOutcome {
  let outcome: PromiseOutcome;
  switch (input.readback?.status) {
    case 'passed':
      outcome = 'verified';
      break;
    case 'warning':
      outcome = 'verified';
      break;
    case 'failed':
      outcome = 'failed';
      break;
    case 'skipped':
    default:
      outcome = 'unverified';
      break;
  }
  if (input.readbackFindings?.some(isPromisedSortLossWarning)) {
    outcome = 'failed';
  }
  return outcome;
}

/** One compact line: outcome + the checks that back it + the claim guard. */
export function formatWorksheetPromiseCheck(input: WorksheetReceiptInput): string {
  const parts: string[] = [formatPreflight(input.validationWarnings), 'apply completed'];
  const hasFindings = (input.readback?.findings?.length ?? 0) > 0;
  switch (input.readback?.status) {
    case 'passed':
      parts.push('readback clean');
      break;
    case 'warning':
      parts.push('readback warnings (listed above)');
      break;
    case 'failed':
      parts.push(
        hasFindings ? 'verification failed (see findings)' : 'readback FAILED (nodes dropped)',
      );
      break;
    case 'skipped':
    default:
      parts.push(hasFindings ? 'verification incomplete (see findings)' : 'readback unavailable');
      break;
  }
  const outcome = classifyWorksheetPromiseOutcome(input);
  if (
    (input.readback?.status === 'passed' || input.readback?.status === 'warning') &&
    input.readbackFindings?.some(isPromisedSortLossWarning)
  ) {
    parts.push('promised sort NOT verified (sort node dropped/changed on readback)');
  }
  const guard =
    outcome === 'verified'
      ? ' No host evidence of any workbook problem beyond the findings listed above — do not report unlisted issues.'
      : ' Do not claim the change is confirmed; report only the evidence above.';
  return `\n\nHOST VERIFICATION — ${outcome}: ${parts.join(' · ')}.${guard}`;
}

/** Desktop's own warnings, one per line, so the agent and user see exactly what it dropped. */
export function formatDesktopWarnings(
  desktopWarnings: readonly ExecuteCommandWarning[],
  context = ' while applying',
): string {
  if (desktopWarnings.length === 0) return '';
  const lines = desktopWarnings.map((warning) => `- ${warning.code}: ${warning.message}`);
  return `\n\nDESKTOP WARNINGS — Desktop reported ${desktopWarnings.length} warning(s)${context}; each names something it dropped or changed:\n${lines.join('\n')}`;
}

function unverifiedGuard(
  scope: 'dashboard' | 'sheet-level',
  desktopWarnings: readonly ExecuteCommandWarning[],
): string {
  const state = scope === 'dashboard' ? 'Treat dashboard state' : 'Treat sheet-level state';
  return desktopWarnings.length > 0
    ? `. ${state} as unconfirmed until read back; Desktop's warnings are host evidence, so report them to the user.`
    : `. ${state} as unconfirmed until read back; do not report problems without host evidence.`;
}

function desktopWarningPart(desktopWarnings: readonly ExecuteCommandWarning[]): string[] {
  return desktopWarnings.length > 0
    ? [`Desktop reported ${desktopWarnings.length} warning(s)`]
    : [];
}

/**
 * Whole-workbook applies have NO structural readback today — say so instead of
 * letting success text imply full verification.
 */
export function formatWorkbookPromiseCheck(
  validationWarnings: ValidationIssue[],
  desktopWarnings: readonly ExecuteCommandWarning[],
): string {
  const parts = [
    formatPreflight(validationWarnings),
    'apply completed',
    ...desktopWarningPart(desktopWarnings),
    'full workbook intent NOT re-verified',
  ];
  return `\n\nHOST VERIFICATION — unverified: ${parts.join(' · ')}${unverifiedGuard('sheet-level', desktopWarnings)}`;
}

/** Dashboard applies likewise have no structural readback — honest by construction. */
export function formatDashboardPromiseCheck(
  validationWarnings: ValidationIssue[],
  desktopWarnings: readonly ExecuteCommandWarning[],
): string {
  const parts = [
    formatPreflight(validationWarnings),
    'apply completed',
    ...desktopWarningPart(desktopWarnings),
    'full dashboard intent NOT re-verified',
  ];
  return `\n\nHOST VERIFICATION — unverified: ${parts.join(' · ')}${unverifiedGuard('dashboard', desktopWarnings)}`;
}
