import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok, type Result } from 'ts-results-es';
import { z } from 'zod';

import {
  type BatchApplyOutcome,
  currentEpisodeId,
  emitEpisodeEvent,
  episodeSessionIdFromArgs,
} from '../../../../desktop/episode-events.js';
import type { ExecuteCommandError } from '../../../../desktop/externalApi/executorTypes.js';
import {
  deleteDashboard,
  listWorkbookDashboards,
} from '../../../../desktop/metadata/dashboards.js';
import { findAllWorksheets, parseXML } from '../../../../desktop/metadata/parser.js';
import {
  extractSheetXml,
  upsertWorksheetAndWindowIntoWorkbook,
} from '../../../../desktop/metadata/sheets.js';
import { compareTargetWorksheetState } from '../../../../desktop/metadata/targetWorksheetState.js';
import { resolveSession } from '../../../../desktop/session/sessionResolution.js';
import {
  getTemplateArtifactStore,
  type TemplateArtifactReserveResult,
  type TemplateArtifactStore,
} from '../../../../desktop/templates/templateArtifactStore.js';
import {
  formatReadbackVerificationError,
  formatReadbackVerificationWarnings,
  type VerificationReport,
  verifyWorksheetReadback,
  withVerificationFinding,
} from '../../../../desktop/validation/readback-verify.js';
import {
  blockingValidationIssues,
  introducedBlockingValidationIssues,
  runValidation,
} from '../../../../desktop/validation/registry.js';
import { targetDashboardInvariantIssues } from '../../../../desktop/validation/targetDashboardInvariant.js';
import { activateSheetWithValidatedGoto } from '../../../../desktop/wrappers/activateSheet.js';
import { getWorkbookXml } from '../../../../desktop/wrappers/getWorkbookXml.js';
import {
  describeLoadWorkbookXmlError,
  loadWorkbookXml,
  type LoadWorkbookXmlError,
} from '../../../../desktop/wrappers/loadWorkbookXml.js';
import { resolveCanonicalWorksheetName } from '../../../../desktop/wrappers/loadWorksheetXml.js';
import { pollReadback } from '../../../../desktop/wrappers/pollReadback.js';
import { xmlNamesEqual } from '../../../../desktop/xmlElement.js';
import {
  DesktopCommandExecutionError,
  IncompleteOperationError,
  type McpToolError,
} from '../../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../../server.desktop.js';
import { getExceptionMessage } from '../../../../utils/getExceptionMessage.js';
import { templateArtifactUnavailableError } from '../../api/applyWorksheetArtifact.js';
import { runVisualErrorCheck } from '../../api/visualErrorCheck.js';
import { sessionParam } from '../../params.js';
import { jsonToolResult, type StructuredResult } from '../../structuredContent.js';
import { DesktopTool } from '../../tool.js';
import {
  buildDashboardCandidateXml,
  dashboardCandidateReadbackIssues,
  resolveRenderedWorksheetNames,
} from './composeDashboardCore.js';

const paramsSchema = {
  session: sessionParam({ max: 64 }),
  artifactIds: z.array(z.string().trim().min(1).max(255)).max(6).optional().describe('IDs.'),
  dashboardName: z.string().trim().min(1).max(255).describe('Name.'),
  existingWorksheetNames: z
    .array(z.string().trim().min(1).max(255))
    .max(6)
    .optional()
    .describe('Live sheets.'),
  title: z.string().trim().min(1).max(255).optional().describe('Title.'),
  layoutType: z.enum(['auto-grid', 'rows', 'columns']).optional().describe('Layout.'),
  gridColumns: z.number().int().min(1).max(6).optional().describe('Cols.'),
};

type AppliedState = true | false | 'unknown';

type StepReceipt =
  | {
      index: number;
      operation: 'worksheet';
      artifactId: string;
      state: 'applied';
      retrySafe: false;
      title: string;
      verification: VerificationReport;
    }
  | {
      index: number;
      operation: 'worksheet';
      artifactId: string;
      state: 'failed' | 'unknown';
      retrySafe: boolean;
      error?: string;
      title?: string;
      verification?: VerificationReport;
    }
  | {
      index: number;
      operation: 'dashboard';
      dashboardName: string;
      state: 'applied';
      retrySafe: false;
      worksheets: string[];
      replaced: boolean;
      verification: VerificationReport;
    }
  | {
      index: number;
      operation: 'dashboard';
      dashboardName: string;
      state: 'failed' | 'unknown';
      retrySafe: boolean;
      stage: string;
      error: string;
    }
  | {
      index: number;
      operation: 'worksheet' | 'dashboard';
      state: 'aborted' | 'skipped';
      retrySafe: true;
      artifactId?: string;
      dashboardName?: string;
      reason: string;
    };

type RunDashboardBatchPayload = {
  applied: AppliedState;
  retrySafe: boolean;
  steps: StepReceipt[];
};

type RunDashboardBatchResult = StructuredResult<RunDashboardBatchPayload>;
type Reservation = Extract<TemplateArtifactReserveResult, { ok: true }>;
type LoadWorkbookXmlFailure =
  | { type: 'execute-command-error'; error: ExecuteCommandError }
  | { type: 'load-workbook-xml-error'; error: LoadWorkbookXmlError };

type WorksheetVerification = {
  artifactId: string;
  title: string;
  verification: VerificationReport;
};

type BatchReadbackVerification = {
  ok: boolean;
  worksheets: WorksheetVerification[];
  dashboardIssues: string[];
};

const title = 'Dashboard';
const MAX_DYNAMIC_TEXT_LENGTH = 384;

export const getRunDashboardBatchTool = (
  server: DesktopMcpServer,
  dependencies: { store?: TemplateArtifactStore } = {},
): DesktopTool<typeof paramsSchema> => {
  const artifactStore = dependencies.store ?? getTemplateArtifactStore(server);
  const tool = new DesktopTool({
    server,
    name: 'run-dashboard-batch',
    title,
    description: 'Apply artifacts; compose.',
    paramsSchema,
    annotations: {
      readOnlyHint: false,
      openWorldHint: false,
      destructiveHint: true,
      idempotentHint: false,
    },
    callback: async (
      {
        session,
        artifactIds,
        dashboardName,
        existingWorksheetNames,
        title: dashboardTitle,
        layoutType,
        gridColumns,
      },
      extra,
    ): Promise<CallToolResult> => {
      const startedAt = performance.now();
      const sessionId = episodeSessionIdFromArgs(extra.config, { session });
      let executionStarted = false;
      const result = await tool.logAndExecute<RunDashboardBatchResult>({
        extra,
        args: {
          session,
          artifactIds,
          dashboardName,
          existingWorksheetNames,
          title: dashboardTitle,
          layoutType,
          gridColumns,
        },
        callback: async (): Promise<Result<RunDashboardBatchResult, McpToolError>> => {
          const orderedArtifactIds = artifactIds ?? [];
          const requestedExistingNames = existingWorksheetNames ?? [];
          const sessionResult = resolveSession(session);
          if (sessionResult.isErr()) return sessionResult.error.toErr();
          const resolvedSession = sessionResult.value;
          const executor = await extra.getExecutor(resolvedSession);
          const steps: StepReceipt[] = [];
          const reservations: Reservation[] = [];
          let leasesFinalized = false;
          const releaseReservations = (): void => {
            if (leasesFinalized) return;
            leasesFinalized = true;
            for (const reservation of reservations) artifactStore.release(reservation.lease);
          };
          const consumeReservations = (): void => {
            if (leasesFinalized) return;
            leasesFinalized = true;
            for (const reservation of reservations) artifactStore.consume(reservation.lease);
          };

          try {
            const duplicateArtifactId = firstDuplicate(orderedArtifactIds);
            if (duplicateArtifactId) {
              return preflightInputFailure(
                steps,
                orderedArtifactIds,
                dashboardName,
                `Duplicate artifact ID: "${duplicateArtifactId}".`,
              );
            }

            for (const [index, artifactId] of orderedArtifactIds.entries()) {
              const reservation = artifactStore.reserve(artifactId, resolvedSession);
              if (!reservation.ok) {
                appendPreflightArtifactFailure(
                  steps,
                  orderedArtifactIds,
                  index,
                  dashboardName,
                  templateArtifactUnavailableError(artifactId, reservation.reason).getErrorText(),
                );
                return incomplete({ applied: false, retrySafe: true, steps });
              }
              reservations.push(reservation);
            }

            const plannedNames = [
              ...requestedExistingNames,
              ...reservations.map((reservation) => reservation.artifact.title),
            ];
            if (plannedNames.length < 1 || plannedNames.length > 6) {
              return preflightInputFailure(
                steps,
                orderedArtifactIds,
                dashboardName,
                'A dashboard batch requires 1-6 combined worksheets.',
              );
            }
            const duplicateName = firstCanonicalDuplicate(plannedNames);
            if (duplicateName) {
              return preflightInputFailure(
                steps,
                orderedArtifactIds,
                dashboardName,
                `Duplicate worksheet name: "${duplicateName}".`,
              );
            }

            const workbookResult = await executor.getWorkbookDocument(extra.signal);
            if (workbookResult.isErr()) {
              return preflightInputFailure(
                steps,
                orderedArtifactIds,
                dashboardName,
                new DesktopCommandExecutionError(workbookResult.error).getErrorText(),
                'workbookRead',
              );
            }
            const workbookXml = workbookResult.value.xml;
            const liveInstanceId = workbookResult.value.instanceId;
            const conflictingWorksheetName = [
              ...findAllWorksheets(parseXML(workbookXml)).map((worksheet) => worksheet['@_name']),
              ...reservations.map((reservation) => reservation.artifact.title),
            ].find(
              (worksheetName): worksheetName is string =>
                typeof worksheetName === 'string' && xmlNamesEqual(worksheetName, dashboardName),
            );
            if (conflictingWorksheetName) {
              return preflightInputFailure(
                steps,
                orderedArtifactIds,
                dashboardName,
                `Dashboard name "${dashboardName}" conflicts with worksheet "${conflictingWorksheetName}". Use a unique dashboard name.`,
              );
            }

            const canonicalArtifactNames: string[] = [];
            for (const [index, reservation] of reservations.entries()) {
              const blockingIssues = blockingValidationIssues(
                runValidation(reservation.artifact.worksheetXml, 'worksheet').issues,
              );
              if (blockingIssues.length > 0) {
                appendPreflightArtifactFailure(
                  steps,
                  orderedArtifactIds,
                  index,
                  dashboardName,
                  `Artifact worksheet failed validation: ${blockingIssues
                    .map((issue) => `${issue.ruleId}: ${issue.message}`)
                    .join('; ')}.`,
                );
                return incomplete({ applied: false, retrySafe: true, steps });
              }
              const canonicalName = resolveCanonicalWorksheetName(
                reservation.artifact.title,
                reservation.artifact.worksheetXml,
              );
              if (canonicalName.isErr()) {
                appendPreflightArtifactFailure(
                  steps,
                  orderedArtifactIds,
                  index,
                  dashboardName,
                  canonicalName.error.message,
                );
                return incomplete({ applied: false, retrySafe: true, steps });
              }
              canonicalArtifactNames.push(canonicalName.value);
              if (!liveInstanceId || reservation.artifact.instanceId !== liveInstanceId) {
                appendPreflightArtifactFailure(
                  steps,
                  orderedArtifactIds,
                  index,
                  dashboardName,
                  'The artifact belongs to a different Desktop instance.',
                );
                return incomplete({ applied: false, retrySafe: true, steps });
              }
              const comparison = compareTargetWorksheetState(
                reservation.artifact.targetState,
                workbookXml,
                reservation.artifact.worksheetXml,
              );
              if (!comparison.ok) {
                appendPreflightArtifactFailure(
                  steps,
                  orderedArtifactIds,
                  index,
                  dashboardName,
                  `The workbook changed after this artifact was built: ${comparison.reasons.join(', ')}.`,
                );
                return incomplete({ applied: false, retrySafe: true, steps });
              }
            }

            const resolvedExistingNames = resolveRenderedWorksheetNames(
              workbookXml,
              requestedExistingNames,
            );
            const missingExistingNames = requestedExistingNames.filter(
              (_, index) => !resolvedExistingNames[index],
            );
            if (missingExistingNames.length > 0) {
              return preflightInputFailure(
                steps,
                orderedArtifactIds,
                dashboardName,
                `Missing live rendered worksheet name(s): ${missingExistingNames
                  .map((name) => `"${name}"`)
                  .join(', ')}.`,
                'existingWorksheet',
              );
            }
            const worksheetNames = [
              ...(resolvedExistingNames as string[]),
              ...canonicalArtifactNames,
            ];

            let candidateXml = workbookXml;
            for (const [index, reservation] of reservations.entries()) {
              try {
                candidateXml = upsertWorksheetAndWindowIntoWorkbook(
                  candidateXml,
                  canonicalArtifactNames[index]!,
                  reservation.artifact.worksheetXml,
                  reservation.artifact.windowXml,
                );
              } catch (error) {
                appendPreflightArtifactFailure(
                  steps,
                  orderedArtifactIds,
                  index,
                  dashboardName,
                  `Could not add the artifact to the workbook candidate: ${getExceptionMessage(error)}`,
                );
                return incomplete({ applied: false, retrySafe: true, steps });
              }
            }

            const existingDashboardName = listWorkbookDashboards(candidateXml).find((name) =>
              xmlNamesEqual(name, dashboardName),
            );
            const replaced = existingDashboardName !== undefined;
            try {
              if (existingDashboardName) {
                candidateXml = deleteDashboard(candidateXml, existingDashboardName);
              }
              candidateXml = buildDashboardCandidateXml({
                baselineXml: candidateXml,
                dashboardName,
                canonicalWorksheetNames: worksheetNames,
                title: dashboardTitle,
                layout: {
                  layoutType: layoutType ?? 'auto-grid',
                  ...(gridColumns ? { gridColumns } : {}),
                },
              });
            } catch (error) {
              return preflightInputFailure(
                steps,
                orderedArtifactIds,
                dashboardName,
                `Could not compose dashboard candidate: ${getExceptionMessage(error)}`,
                'candidateBuild',
              );
            }

            const candidateBlockingIssues = introducedBlockingValidationIssues(
              runValidation(workbookXml, 'workbook').issues,
              runValidation(candidateXml, 'workbook').issues,
            );
            const candidateDashboardIssues = targetDashboardInvariantIssues(
              candidateXml,
              dashboardName,
              worksheetNames,
            );
            if (candidateBlockingIssues.length > 0 || candidateDashboardIssues.length > 0) {
              return preflightInputFailure(
                steps,
                orderedArtifactIds,
                dashboardName,
                [
                  ...candidateBlockingIssues.map((issue) => `${issue.ruleId}: ${issue.message}`),
                  ...candidateDashboardIssues.map((issue) => issue.message),
                ].join('; '),
                'candidateValidation',
              );
            }

            if (extra.signal.aborted) {
              appendAbortedBatch(steps, orderedArtifactIds, dashboardName);
              return incomplete({ applied: false, retrySafe: true, steps });
            }

            let dispatchAttempted = false;
            const applyResult = await loadWorkbookXml({
              xml: candidateXml,
              baselineXml: workbookXml,
              expectedWorkbookXml: workbookXml,
              focus: { navigate: 'none', reason: 'intermediate-leg' },
              executor,
              signal: extra.signal,
              applyOptions: {
                expectedInstanceId: liveInstanceId,
                onDispatch: () => {
                  dispatchAttempted = true;
                  executionStarted = true;
                  consumeReservations();
                },
              },
            });
            if (applyResult.isErr()) {
              if (dispatchAttempted) {
                return unknownBatch({
                  artifactIds: orderedArtifactIds,
                  reservations,
                  dashboardName,
                  stage: 'apply',
                  error: describeLoadError(applyResult.error),
                });
              }
              return preflightInputFailure(
                steps,
                orderedArtifactIds,
                dashboardName,
                describeLoadError(applyResult.error),
                loadFailureStage(applyResult.error),
              );
            }

            const polled = await pollReadback({
              read: () => getWorkbookXml({ executor, signal: extra.signal }),
              settled: (xml) =>
                verifyBatchReadback(xml, candidateXml, reservations, dashboardName, worksheetNames)
                  .ok,
              signal: extra.signal,
            });
            if (!polled.ok) {
              return unknownBatch({
                artifactIds: orderedArtifactIds,
                reservations,
                dashboardName,
                stage: 'postApplyRead',
                error: new DesktopCommandExecutionError(polled.error).getErrorText(),
              });
            }

            const verification = verifyBatchReadback(
              polled.value,
              candidateXml,
              reservations,
              dashboardName,
              worksheetNames,
            );
            if (!polled.settled || !verification.ok) {
              return unknownBatch({
                artifactIds: orderedArtifactIds,
                reservations,
                dashboardName,
                stage: 'readbackVerification',
                error: boundedText(
                  [...verification.worksheets]
                    .filter(({ verification: item }) => !item.ok)
                    .map(
                      ({ title, verification: item }) => `${title}: ${item.message ?? 'mismatch'}`,
                    )
                    .concat(verification.dashboardIssues)
                    .join('; ') || 'Post-apply verification did not settle.',
                ),
                verification,
              });
            }

            await activateSheetWithValidatedGoto({
              sheetName: dashboardName,
              executor,
              signal: extra.signal,
            });
            // AUTO_VISUAL_CHECK nudge (best-effort): the batch verified structure via XML
            // readback above, which is blind to a red error pill in the rendered dashboard. With
            // the dashboard now activated and the flag on, fold a visual-window finding into the
            // dashboard receipt as a warning — never a hard failure, never flips `applied`.
            const dashboardVerification: VerificationReport = extra.config.autoVisualCheck
              ? withVerificationFinding(
                  { ok: true, status: 'passed' },
                  await runVisualErrorCheck({ executor, signal: extra.signal }),
                )
              : { ok: true, status: 'passed' };
            const successSteps: StepReceipt[] = verification.worksheets.map(
              (
                { artifactId, title: worksheetTitle, verification: worksheetVerification },
                index,
              ) => ({
                index,
                operation: 'worksheet',
                artifactId,
                state: 'applied',
                retrySafe: false,
                title: worksheetTitle,
                verification: worksheetVerification,
              }),
            );
            successSteps.push({
              index: orderedArtifactIds.length,
              operation: 'dashboard',
              dashboardName,
              state: 'applied',
              retrySafe: false,
              worksheets: worksheetNames,
              replaced,
              verification: dashboardVerification,
            });
            return Ok({ applied: true, retrySafe: false, steps: successSteps });
          } catch (error) {
            if (executionStarted) {
              return unknownBatch({
                artifactIds: orderedArtifactIds,
                reservations,
                dashboardName,
                stage: 'unexpected-error',
                error: boundedUnexpectedError(error),
              });
            }
            return preflightInputFailure(
              steps,
              orderedArtifactIds,
              dashboardName,
              boundedUnexpectedError(error),
              'unexpectedPreDispatchError',
            );
          } finally {
            releaseReservations();
          }
        },
        getSuccessResult: (result) => jsonToolResult(result, { isError: false }),
      });
      void emitEpisodeEvent(extra.config, {
        type: 'batch_apply',
        session_id: sessionId,
        episode_id: currentEpisodeId(sessionId),
        artifact_count: artifactIds?.length ?? 0,
        existing_worksheet_count: existingWorksheetNames?.length ?? 0,
        duration_ms: performance.now() - startedAt,
        outcome: batchApplyOutcome(result, executionStarted),
      });
      return result;
    },
  });

  return tool;
};

function verifyBatchReadback(
  workbookXml: string,
  candidateXml: string,
  reservations: Reservation[],
  dashboardName: string,
  worksheetNames: string[],
): BatchReadbackVerification {
  const worksheets = reservations.map((reservation): WorksheetVerification => {
    const { id: artifactId, title: worksheetTitle, worksheetXml } = reservation.artifact;
    const fragment = extractSheetXml(workbookXml, worksheetTitle);
    if (fragment === null) {
      return {
        artifactId,
        title: worksheetTitle,
        verification: {
          ok: false,
          status: 'failed',
          message: `Worksheet "${worksheetTitle}" was absent from workbook readback.`,
        },
      };
    }
    const findings = verifyWorksheetReadback(worksheetXml, fragment);
    if (findings.some((finding) => finding.severity === 'error')) {
      return {
        artifactId,
        title: worksheetTitle,
        verification: {
          ok: false,
          status: 'failed',
          message: boundedText(formatReadbackVerificationError(findings)),
        },
      };
    }
    if (findings.some((finding) => finding.severity === 'warning')) {
      return {
        artifactId,
        title: worksheetTitle,
        verification: {
          ok: true,
          status: 'warning',
          message: boundedText(formatReadbackVerificationWarnings(findings).trim()),
        },
      };
    }
    return {
      artifactId,
      title: worksheetTitle,
      verification: { ok: true, status: 'passed' },
    };
  });
  const dashboardIssues = dashboardCandidateReadbackIssues(
    workbookXml,
    candidateXml,
    dashboardName,
    worksheetNames,
  );
  return {
    ok: worksheets.every(({ verification }) => verification.ok) && dashboardIssues.length === 0,
    worksheets,
    dashboardIssues,
  };
}

function unknownBatch({
  artifactIds,
  reservations,
  dashboardName,
  stage,
  error,
  verification,
}: {
  artifactIds: string[];
  reservations: Reservation[];
  dashboardName: string;
  stage: string;
  error: string;
  verification?: BatchReadbackVerification;
}): ReturnType<IncompleteOperationError<RunDashboardBatchPayload>['toErr']> {
  const steps: StepReceipt[] = artifactIds.map((artifactId, index) => {
    const item = verification?.worksheets[index];
    return {
      index,
      operation: 'worksheet',
      artifactId,
      state: 'unknown',
      retrySafe: false,
      title: reservations[index]?.artifact.title,
      ...(item ? { verification: boundedVerification(item.verification) } : {}),
    };
  });
  steps.push({
    index: artifactIds.length,
    operation: 'dashboard',
    dashboardName,
    state: 'unknown',
    retrySafe: false,
    stage,
    error: boundedText(error),
  });
  return incomplete({ applied: 'unknown', retrySafe: false, steps });
}

function boundedVerification(verification: VerificationReport): VerificationReport {
  return verification.message
    ? { ...verification, message: boundedText(verification.message) }
    : verification;
}

function describeLoadError(error: LoadWorkbookXmlFailure): string {
  if (error.type === 'execute-command-error') {
    return new DesktopCommandExecutionError(error.error).getErrorText();
  }
  return describeLoadWorkbookXmlError(error.error);
}

function loadFailureStage(error: LoadWorkbookXmlFailure): string {
  return error.type === 'load-workbook-xml-error' && error.error.type === 'workbook-drift'
    ? 'workbookDrift'
    : 'preDispatchApply';
}

function batchApplyOutcome(result: CallToolResult, executionStarted: boolean): BatchApplyOutcome {
  const content = result.content.find((item) => item.type === 'text');
  if (!content || content.type !== 'text') return 'refused';
  try {
    const payload = JSON.parse(content.text) as {
      applied?: AppliedState;
      steps?: Array<{ state?: string }>;
    };
    if (payload.applied === true) return 'succeeded';
    if (payload.applied === 'unknown') return 'unknown';
    if (payload.steps?.some((step) => step.state === 'aborted')) return 'aborted';
    if (payload.applied === false) return executionStarted ? 'failed' : 'refused';
  } catch {
    // Non-structured failures are refusals before a batch outcome exists.
  }
  return 'refused';
}

function incomplete(
  payload: RunDashboardBatchPayload,
): ReturnType<IncompleteOperationError<RunDashboardBatchPayload>['toErr']> {
  return new IncompleteOperationError(payload).toErr();
}

function boundedUnexpectedError(error: unknown): string {
  return boundedText(getExceptionMessage(error));
}

function boundedText(message: string): string {
  return message.length <= MAX_DYNAMIC_TEXT_LENGTH
    ? message
    : `${message.slice(0, MAX_DYNAMIC_TEXT_LENGTH - 3)}...`;
}

function firstDuplicate(values: readonly string[]): string | undefined {
  return values.find((value, index) => values.indexOf(value) !== index);
}

function firstCanonicalDuplicate(values: readonly string[]): string | undefined {
  return values.find(
    (value, index) => values.findIndex((candidate) => xmlNamesEqual(candidate, value)) !== index,
  );
}

function preflightInputFailure(
  steps: StepReceipt[],
  artifactIds: readonly string[],
  dashboardName: string,
  error: string,
  stage = 'inputValidation',
): ReturnType<IncompleteOperationError<RunDashboardBatchPayload>['toErr']> {
  const reason = 'Preflight failed before any writes.';
  appendSkippedArtifacts(steps, artifactIds, 0, reason);
  steps.push({
    index: artifactIds.length,
    operation: 'dashboard',
    dashboardName,
    state: 'failed',
    retrySafe: true,
    stage,
    error: boundedText(error),
  });
  return incomplete({ applied: false, retrySafe: true, steps });
}

function appendPreflightArtifactFailure(
  steps: StepReceipt[],
  artifactIds: readonly string[],
  failedIndex: number,
  dashboardName: string,
  error: string,
): void {
  const reason = 'Preflight failed before any writes.';
  appendSkippedArtifacts(steps, artifactIds, 0, reason);
  steps[failedIndex] = {
    index: failedIndex,
    operation: 'worksheet',
    artifactId: artifactIds[failedIndex]!,
    state: 'failed',
    retrySafe: true,
    error: boundedText(error),
  };
  appendSkippedCompose(steps, artifactIds.length, dashboardName, reason);
}

function appendAbortedBatch(
  steps: StepReceipt[],
  artifactIds: readonly string[],
  dashboardName: string,
): void {
  for (const [index, artifactId] of artifactIds.entries()) {
    steps.push({
      index,
      operation: 'worksheet',
      artifactId,
      state: 'aborted',
      retrySafe: true,
      reason: 'The request was aborted before the batch write started.',
    });
  }
  steps.push({
    index: artifactIds.length,
    operation: 'dashboard',
    dashboardName,
    state: 'aborted',
    retrySafe: true,
    reason: 'The request was aborted before the batch write started.',
  });
}

function appendSkippedArtifacts(
  steps: StepReceipt[],
  artifactIds: readonly string[],
  startIndex: number,
  reason: string,
): void {
  for (let index = startIndex; index < artifactIds.length; index += 1) {
    steps.push({
      index,
      operation: 'worksheet',
      artifactId: artifactIds[index]!,
      state: 'skipped',
      retrySafe: true,
      reason,
    });
  }
}

function appendSkippedCompose(
  steps: StepReceipt[],
  index: number,
  dashboardName: string,
  reason: string,
): void {
  steps.push({
    index,
    operation: 'dashboard',
    dashboardName,
    state: 'skipped',
    retrySafe: true,
    reason,
  });
}
