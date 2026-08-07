import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok, type Result } from 'ts-results-es';
import { z } from 'zod';

import { resolveSession } from '../../../../desktop/session/sessionResolution.js';
import {
  getTemplateArtifactStore,
  type TemplateArtifactStore,
} from '../../../../desktop/templates/templateArtifactStore.js';
import { IncompleteOperationError, type McpToolError } from '../../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../../server.desktop.js';
import { getExceptionMessage } from '../../../../utils/getExceptionMessage.js';
import { applyWorksheetArtifact } from '../../api/applyWorksheetArtifact.js';
import { sessionParam } from '../../params.js';
import { jsonToolResult, type StructuredResult } from '../../structuredContent.js';
import { DesktopTool } from '../../tool.js';
import { composeDashboardCore } from './composeDashboardCore.js';

const paramsSchema = {
  session: sessionParam({ max: 64 }),
  artifactIds: z.array(z.string().trim().min(1).max(255)).max(6).optional().describe('IDs.'),
  dashboardName: z.string().trim().min(1).max(255).describe('Name.'),
  worksheetNames: z.array(z.string().trim().min(1).max(255)).min(1).max(6).describe('Sheets.'),
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
const MAX_UNEXPECTED_ERROR_LENGTH = 500;

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
        worksheetNames,
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
          worksheetNames,
          title: dashboardTitle,
          layoutType,
          gridColumns,
        },
        callback: async (): Promise<Result<RunDashboardBatchResult, McpToolError>> => {
          const orderedArtifactIds = artifactIds ?? [];
          const sessionResult = resolveSession(session);
          if (sessionResult.isErr()) return sessionResult.error.toErr();
          const resolvedSession = sessionResult.value;
          const executor = await extra.getExecutor(resolvedSession);
          const steps: StepReceipt[] = [];
          let successfulMutations = 0;

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
                    ...(verification.message ? { message: verification.message } : {}),
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
                  ...(verification.message ? { message: verification.message } : {}),
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
              error: outcome.error.getErrorText(),
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
              worksheetNames,
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
            error: composeOutcome.error.getErrorText(),
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
  const message = getExceptionMessage(error);
  return message.length <= MAX_UNEXPECTED_ERROR_LENGTH
    ? message
    : `${message.slice(0, MAX_UNEXPECTED_ERROR_LENGTH - 3)}...`;
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
