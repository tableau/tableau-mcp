import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok, type Result } from 'ts-results-es';
import { z } from 'zod';

import { compareTargetWorksheetState } from '../../../../desktop/metadata/targetWorksheetState.js';
import { resolveSession } from '../../../../desktop/session/sessionResolution.js';
import {
  getTemplateArtifactStore,
  type TemplateArtifactReserveResult,
  type TemplateArtifactStore,
} from '../../../../desktop/templates/templateArtifactStore.js';
import {
  blockingValidationIssues,
  runValidation,
} from '../../../../desktop/validation/registry.js';
import { resolveCanonicalWorksheetName } from '../../../../desktop/wrappers/loadWorksheetXml.js';
import { xmlNamesEqual } from '../../../../desktop/xmlElement.js';
import {
  DesktopCommandExecutionError,
  IncompleteOperationError,
  type McpToolError,
} from '../../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../../server.desktop.js';
import { getExceptionMessage } from '../../../../utils/getExceptionMessage.js';
import {
  applyWorksheetArtifact,
  templateArtifactUnavailableError,
} from '../../api/applyWorksheetArtifact.js';
import { sessionParam } from '../../params.js';
import { jsonToolResult, type StructuredResult } from '../../structuredContent.js';
import { DesktopTool } from '../../tool.js';
import { composeDashboardCore, resolveRenderedWorksheetNames } from './composeDashboardCore.js';

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

type AppliedState = true | false | 'partial' | 'unknown';

type StepReceipt =
  | {
      index: number;
      operation: 'worksheet';
      artifactId: string;
      state: 'applied';
      retrySafe: false;
      title: string;
      verification: { ok: boolean; status: 'passed' | 'warning'; message?: string };
    }
  | {
      index: number;
      operation: 'worksheet';
      artifactId: string;
      state: 'failed' | 'unknown';
      retrySafe: boolean;
      error?: string;
      title?: string;
      verification?: {
        ok: boolean;
        status: 'failed' | 'skipped';
        message?: string;
      };
    }
  | {
      index: number;
      operation: 'dashboard';
      dashboardName: string;
      state: 'applied';
      retrySafe: false;
      worksheets: string[];
      replaced: boolean;
      verification: { status: 'passed'; issues: [] };
    }
  | {
      index: number;
      operation: 'dashboard';
      dashboardName: string;
      state: 'failed' | 'partial' | 'unknown';
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
      return await tool.logAndExecute<RunDashboardBatchResult>({
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
          let successfulMutations = 0;
          const duplicateArtifactId = firstDuplicate(orderedArtifactIds);
          if (duplicateArtifactId) {
            return preflightInputFailure(
              steps,
              orderedArtifactIds,
              dashboardName,
              `Duplicate artifact ID: "${duplicateArtifactId}".`,
            );
          }

          const reservations: Array<Extract<TemplateArtifactReserveResult, { ok: true }>> = [];
          try {
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
            const canonicalExistingNames = resolvedExistingNames as string[];

            for (const [index, artifactId] of orderedArtifactIds.entries()) {
              if (extra.signal.aborted) {
                const reason = `stopped after task ${index} aborted`;
                steps.push(abortedApplyReceipt(artifactId, index));
                appendSkippedArtifacts(steps, orderedArtifactIds, index + 1, reason);
                appendSkippedCompose(steps, orderedArtifactIds.length, dashboardName, reason);
                return incomplete({
                  applied: successfulMutations > 0 ? 'partial' : false,
                  retrySafe: successfulMutations === 0,
                  steps,
                });
              }

              let outcome: Awaited<ReturnType<typeof applyWorksheetArtifact>>;
              try {
                outcome = await applyWorksheetArtifact({
                  store: artifactStore,
                  artifactId,
                  sessionId: resolvedSession,
                  executor,
                  signal: extra.signal,
                  reservation: reservations[index],
                });
              } catch (error) {
                steps.push({
                  index,
                  operation: 'worksheet',
                  artifactId,
                  state: 'unknown',
                  retrySafe: false,
                  error: boundedUnexpectedError(error),
                });
                const reason = `stopped after task ${index} ended unexpectedly`;
                appendSkippedArtifacts(steps, orderedArtifactIds, index + 1, reason);
                appendSkippedCompose(steps, orderedArtifactIds.length, dashboardName, reason);
                return incomplete({ applied: 'unknown', retrySafe: false, steps });
              }

              if (outcome.state === 'applied') {
                successfulMutations += 1;
                const { verification } = outcome.receipt;
                if (verification.status === 'failed' || verification.status === 'skipped') {
                  steps.push({
                    index,
                    operation: 'worksheet',
                    artifactId,
                    state: 'unknown',
                    retrySafe: false,
                    title: outcome.receipt.title,
                    verification: {
                      ok: verification.ok,
                      status: verification.status,
                      ...(verification.message
                        ? { message: boundedText(verification.message) }
                        : {}),
                    },
                  });
                  const reason = `stopped after task ${index} could not be verified`;
                  appendSkippedArtifacts(steps, orderedArtifactIds, index + 1, reason);
                  appendSkippedCompose(steps, orderedArtifactIds.length, dashboardName, reason);
                  return incomplete({ applied: 'unknown', retrySafe: false, steps });
                }

                steps.push({
                  index,
                  operation: 'worksheet',
                  artifactId,
                  state: 'applied',
                  retrySafe: false,
                  title: outcome.receipt.title,
                  verification: {
                    ok: verification.ok,
                    status: verification.status,
                    ...(verification.message ? { message: boundedText(verification.message) } : {}),
                  },
                });
                continue;
              }

              steps.push({
                index,
                operation: 'worksheet',
                artifactId,
                state: outcome.state,
                retrySafe: outcome.retrySafe,
                error: boundedText(outcome.error.getErrorText()),
              });
              const reason = `stopped after task ${index} failed`;
              appendSkippedArtifacts(steps, orderedArtifactIds, index + 1, reason);
              appendSkippedCompose(steps, orderedArtifactIds.length, dashboardName, reason);
              if (outcome.state === 'unknown') {
                return incomplete({ applied: 'unknown', retrySafe: false, steps });
              }
              return incomplete({
                applied: successfulMutations > 0 ? 'partial' : false,
                retrySafe: successfulMutations === 0 && outcome.retrySafe,
                steps,
              });
            }

            const composeIndex = orderedArtifactIds.length;
            if (extra.signal.aborted) {
              steps.push({
                index: composeIndex,
                operation: 'dashboard',
                dashboardName,
                state: 'aborted',
                retrySafe: true,
                reason: 'The request was aborted before this task started.',
              });
              return incomplete({
                applied: successfulMutations > 0 ? 'partial' : false,
                retrySafe: successfulMutations === 0,
                steps,
              });
            }

            let composeOutcome: Awaited<ReturnType<typeof composeDashboardCore>>;
            try {
              composeOutcome = await composeDashboardCore({
                dashboardName,
                worksheetNames: [
                  ...canonicalExistingNames,
                  ...reservations.map((reservation) => reservation.artifact.title),
                ],
                title: dashboardTitle,
                layout: {
                  layoutType: layoutType ?? 'auto-grid',
                  ...(gridColumns ? { gridColumns } : {}),
                },
                executor,
                signal: extra.signal,
              });
            } catch (error) {
              steps.push({
                index: composeIndex,
                operation: 'dashboard',
                dashboardName,
                state: 'unknown',
                retrySafe: false,
                stage: 'unexpected-error',
                error: boundedUnexpectedError(error),
              });
              return incomplete({ applied: 'unknown', retrySafe: false, steps });
            }

            if (composeOutcome.state === 'applied') {
              steps.push({
                index: composeIndex,
                operation: 'dashboard',
                dashboardName,
                state: 'applied',
                retrySafe: false,
                worksheets: composeOutcome.receipt.worksheets,
                replaced: composeOutcome.receipt.replaced,
                verification: composeOutcome.receipt.verification,
              });
              return Ok({ applied: true, retrySafe: false, steps });
            }

            steps.push({
              index: composeIndex,
              operation: 'dashboard',
              dashboardName,
              state: composeOutcome.state,
              retrySafe: composeOutcome.retrySafe,
              stage: composeOutcome.stage,
              error: boundedText(composeOutcome.error.getErrorText()),
            });
            if (composeOutcome.state === 'unknown') {
              return incomplete({ applied: 'unknown', retrySafe: false, steps });
            }
            if (composeOutcome.state === 'partial') {
              return incomplete({ applied: 'partial', retrySafe: false, steps });
            }
            return incomplete({
              applied: successfulMutations > 0 ? 'partial' : false,
              retrySafe: successfulMutations === 0 && composeOutcome.retrySafe,
              steps,
            });
          } finally {
            for (const reservation of reservations) artifactStore.release(reservation.lease);
          }
        },
        getSuccessResult: (result) => jsonToolResult(result, { isError: false }),
      });
    },
  });

  return tool;
};

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

function abortedApplyReceipt(artifactId: string, index: number): StepReceipt {
  return {
    index,
    operation: 'worksheet',
    artifactId,
    state: 'aborted',
    retrySafe: true,
    reason: 'The request was aborted before this task started.',
  };
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
