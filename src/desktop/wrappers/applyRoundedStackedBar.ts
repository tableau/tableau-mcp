import { Err, Ok } from 'ts-results-es';

import type {
  ExecuteCommandError,
  WithExecutorAndAbortSignal,
} from '../externalApi/executorTypes.js';
import type { RoundStackedBarSemanticContract } from '../refine/roundStackedBar.js';
import {
  captureRoundStackedBarBaseline,
  type RoundStackedBarBaseline,
  type RoundStackedBarFinding,
  verifyRoundStackedBarPostSummary,
  verifyRoundStackedBarSeedEvidence,
  verifyRoundStackedBarSourceWorkbook,
  verifyRoundStackedBarStructure,
} from '../refine/roundStackedBarVerification.js';
import type { ApplyFocus } from './applyFocus.js';
import { withApplyLock } from './applyMutex.js';
import { sourceSha256 } from './cacheFingerprint.js';
import { tryApplyViaPerSheetRoute } from './perSheetDocumentApply.js';
import { pollReadback } from './pollReadback.js';

export type ApplyRoundedStackedBarOutcome =
  | {
      state: 'applied';
      mutation: 'sent';
      retrySafe: false;
      worksheet: { id: string; name: string };
      baseline: RoundStackedBarBaseline;
    }
  | {
      state: 'failed';
      mutation: 'not-sent';
      retrySafe: true;
      stage: string;
      message: string;
      error?: ExecuteCommandError;
      findings?: RoundStackedBarFinding[];
    }
  | {
      state: 'unknown';
      mutation: 'sent' | 'unknown';
      retrySafe: false;
      stage: string;
      message: string;
      error?: ExecuteCommandError;
      findings?: RoundStackedBarFinding[];
    };

export async function applyRoundedStackedBar({
  sourceWorksheetXml,
  intendedWorksheetXml,
  contract,
  focus,
  executor,
  signal,
}: {
  sourceWorksheetXml: string;
  intendedWorksheetXml: string;
  contract: RoundStackedBarSemanticContract;
  focus: ApplyFocus;
} & WithExecutorAndAbortSignal): Promise<ApplyRoundedStackedBarOutcome> {
  return await withApplyLock(async () => {
    const liveSource = await executor.getWorksheetDocument(contract.worksheetId, signal);
    if (liveSource.isErr()) {
      return {
        state: 'failed',
        mutation: 'not-sent',
        retrySafe: true,
        stage: 'source-read',
        message: 'Could not re-read the worksheet before applying rounded bars.',
        error: liveSource.error,
      };
    }
    if (sourceSha256(liveSource.value.xml) !== sourceSha256(sourceWorksheetXml)) {
      return {
        state: 'failed',
        mutation: 'not-sent',
        retrySafe: true,
        stage: 'source-drift',
        message: 'The worksheet changed after the rounded-bar conversion was planned.',
      };
    }

    const summary = await executor.getWorksheetSummaryData(
      contract.worksheetId,
      { maxRows: 1000, ignoreAliases: true, ignoreSelection: true },
      signal,
    );
    if (summary.isErr()) {
      return beforeMutationFailure(
        'summary-read',
        'Could not read the visible Category×Segment groups before applying rounded bars.',
        summary.error,
      );
    }
    const baselineResult = captureRoundStackedBarBaseline(
      {
        worksheet: { id: contract.worksheetId },
        columns: summary.value.columns ?? [],
        rows: summary.value.rows ?? [],
      },
      contract,
    );
    if (!baselineResult.ok) {
      return beforeMutationFailure('summary-preflight', baselineResult.reason);
    }
    const baseline = baselineResult.baseline;

    const logicalTables = await executor.listWorksheetLogicalTables(contract.worksheetId, signal);
    if (logicalTables.isErr()) {
      return beforeMutationFailure(
        'logical-table-read',
        'Could not list the worksheet logical tables before applying rounded bars.',
        logicalTables.error,
      );
    }
    const tables = logicalTables.value.tables ?? [];
    const logicalTableId = tables.length === 1 ? tables[0].id?.trim() : undefined;
    if (!logicalTableId) {
      return beforeMutationFailure(
        'logical-table-preflight',
        `Rounded stacked bars require exactly one logical table with an id (found ${tables.length}).`,
      );
    }

    const requestedUnderlyingColumns = unique([
      qualifyField(contract.datasource.caption, contract.category.caption),
      qualifyField(contract.datasource.caption, contract.segment.caption),
      qualifyField(contract.datasource.caption, contract.measure.caption),
      ...(contract.filter
        ? [qualifyField(contract.datasource.caption, contract.filter.caption)]
        : []),
    ]);
    const underlying = await executor.getWorksheetUnderlyingData(
      contract.worksheetId,
      logicalTableId,
      {
        maxRows: 10_000,
        ignoreAliases: true,
        ignoreSelection: true,
        columnsToIncludeByFieldName: requestedUnderlyingColumns,
      },
      signal,
    );
    if (underlying.isErr()) {
      return beforeMutationFailure(
        'underlying-data-read',
        'Could not read the raw seed witnesses before applying rounded bars.',
        underlying.error,
      );
    }
    const seedVerification = verifyRoundStackedBarSeedEvidence(
      {
        columns: underlying.value.columns ?? [],
        rows: underlying.value.rows ?? [],
      },
      baseline,
      contract,
    );
    if (!seedVerification.ok) {
      return beforeMutationFailure(
        'seed-preflight',
        formatFindings(seedVerification.findings),
        undefined,
        seedVerification.findings,
      );
    }

    const sourceWorkbook = await executor.getWorkbookDocument(signal);
    if (sourceWorkbook.isErr()) {
      return beforeMutationFailure(
        'workbook-read',
        'Could not read the workbook identity baseline before applying rounded bars.',
        sourceWorkbook.error,
      );
    }
    const workbookPreflight = verifyRoundStackedBarSourceWorkbook(
      sourceWorkbook.value.xml,
      contract,
      liveSource.value.xml,
    );
    if (!workbookPreflight.ok) {
      return beforeMutationFailure(
        'workbook-preflight',
        formatFindings(workbookPreflight.findings),
        undefined,
        workbookPreflight.findings,
      );
    }

    let applied: Awaited<ReturnType<typeof tryApplyViaPerSheetRoute>>;
    try {
      applied = await tryApplyViaPerSheetRoute({
        kind: 'worksheet',
        sheetName: contract.worksheetId,
        fragmentXml: intendedWorksheetXml,
        expectedSourceHash: sourceSha256(liveSource.value.xml),
        validationContext: 'worksheet',
        focus,
        executor,
        signal,
      });
    } catch (error) {
      return afterMutationUnknown(
        'apply-transport',
        'The per-sheet apply transport threw and cannot prove whether Desktop received the write.',
        'unknown',
        { type: 'unknown', error },
      );
    }
    if (applied.isErr()) {
      return afterMutationUnknown(
        'apply-transport',
        'The per-sheet apply transport failed and cannot prove whether Desktop received the write.',
        'unknown',
        applied.error,
      );
    }
    const applyOutcome = applied.value;
    if (typeof applyOutcome !== 'object' || !('status' in applyOutcome)) {
      const detail =
        typeof applyOutcome === 'string'
          ? applyOutcome
          : applyOutcome.type === 'validation-failed'
            ? 'validation-failed'
            : applyOutcome.type;
      return beforeMutationFailure(
        'apply-preflight',
        `Rounded stacked bars were not sent because the per-sheet route returned ${detail}.`,
      );
    }
    if (applyOutcome.documentWarnings.length > 0) {
      return afterMutationUnknown(
        'document-warning',
        `Desktop accepted the worksheet but reported ${applyOutcome.documentWarnings.length} document warning(s).`,
        'sent',
      );
    }

    const readback = await (async () => {
      try {
        return await pollReadback({
          read: async () => {
            const worksheet = await executor.getWorksheetDocument(applyOutcome.id, signal);
            if (worksheet.isErr()) return Err(worksheet.error);
            const workbookDocument = await executor.getWorkbookDocument(signal);
            if (workbookDocument.isErr()) return Err(workbookDocument.error);
            const postSummary = await executor.getWorksheetSummaryData(
              applyOutcome.id,
              { maxRows: 1000, ignoreAliases: true, ignoreSelection: true },
              signal,
            );
            if (postSummary.isErr()) return Err(postSummary.error);
            return Ok({
              worksheetXml: worksheet.value.xml,
              workbookXml: workbookDocument.value.xml,
              summary: {
                worksheet: { id: applyOutcome.id },
                columns: postSummary.value.columns ?? [],
                rows: postSummary.value.rows ?? [],
              },
            });
          },
          settled: (evidence) =>
            verifyRoundStackedBarStructure({
              sourceWorksheetXml: liveSource.value.xml,
              intendedWorksheetXml: applyOutcome.fragmentXml,
              readbackWorksheetXml: evidence.worksheetXml,
              sourceWorkbookXml: sourceWorkbook.value.xml,
              readbackWorkbookXml: evidence.workbookXml,
              contract,
            }).ok && verifyRoundStackedBarPostSummary(evidence.summary, baseline, contract).ok,
          signal,
        });
      } catch (error) {
        return { ok: false as const, error: { type: 'unknown' as const, error } };
      }
    })();
    if (!readback.ok) {
      return afterMutationUnknown(
        'readback',
        'Desktop accepted the write, but strict worksheet/workbook/summary readback failed.',
        'sent',
        readback.error,
      );
    }

    const structureVerification = verifyRoundStackedBarStructure({
      sourceWorksheetXml: liveSource.value.xml,
      intendedWorksheetXml: applyOutcome.fragmentXml,
      readbackWorksheetXml: readback.value.worksheetXml,
      sourceWorkbookXml: sourceWorkbook.value.xml,
      readbackWorkbookXml: readback.value.workbookXml,
      contract,
    });
    const summaryVerification = verifyRoundStackedBarPostSummary(
      readback.value.summary,
      baseline,
      contract,
    );
    const findings = [...structureVerification.findings, ...summaryVerification.findings];
    if (!readback.settled || findings.length > 0) {
      return afterMutationUnknown(
        'verification',
        formatFindings(findings),
        'sent',
        undefined,
        findings,
      );
    }

    return {
      state: 'applied',
      mutation: 'sent',
      retrySafe: false,
      worksheet: { id: applyOutcome.id, name: applyOutcome.name },
      baseline,
    };
  });
}

function beforeMutationFailure(
  stage: string,
  message: string,
  error?: ExecuteCommandError,
  findings?: RoundStackedBarFinding[],
): ApplyRoundedStackedBarOutcome {
  return {
    state: 'failed',
    mutation: 'not-sent',
    retrySafe: true,
    stage,
    message,
    ...(error ? { error } : {}),
    ...(findings ? { findings } : {}),
  };
}

function afterMutationUnknown(
  stage: string,
  message: string,
  mutation: 'sent' | 'unknown',
  error?: ExecuteCommandError,
  findings?: RoundStackedBarFinding[],
): ApplyRoundedStackedBarOutcome {
  return {
    state: 'unknown',
    mutation,
    retrySafe: false,
    stage,
    message,
    ...(error ? { error } : {}),
    ...(findings ? { findings } : {}),
  };
}

function qualifyField(datasourceCaption: string, fieldCaption: string): string {
  return `[${datasourceCaption}].[${fieldCaption}]`;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function formatFindings(findings: RoundStackedBarFinding[]): string {
  return findings.length > 0
    ? findings.map((finding) => `${finding.code}: ${finding.message}`).join(' ')
    : 'Rounded-bar verification did not settle before the readback budget expired.';
}
