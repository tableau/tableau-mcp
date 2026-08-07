import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok, type Result } from 'ts-results-es';
import { z } from 'zod';

import { resolveSession } from '../../../../desktop/session/sessionResolution.js';
import {
  getTemplateArtifactStore,
  type TemplateArtifactStore,
} from '../../../../desktop/templates/templateArtifactStore.js';
import {
  ArgsValidationError,
  IncompleteOperationError,
  type McpToolError,
} from '../../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../../server.desktop.js';
import { getExceptionMessage } from '../../../../utils/getExceptionMessage.js';
import { applyWorksheetArtifact } from '../../api/applyWorksheetArtifact.js';
import { sessionParam } from '../../params.js';
import { jsonToolResult, type StructuredResult } from '../../structuredContent.js';
import { DesktopTool } from '../../tool.js';
import type { DesktopToolName } from '../../toolName.js';
import { composeDashboardCore } from './composeDashboardCore.js';

const applyTaskSchema = z.object({
  tool: z.literal('apply-worksheet').describe('Task kind.'),
  artifactId: z.string().trim().min(1).max(255).describe('Template artifact ID.'),
});

const layoutSchema = z.object({
  layoutType: z
    .enum(['auto-grid', 'rows', 'columns'])
    .optional()
    .default('auto-grid')
    .describe('Zone arrangement.'),
  gridColumns: z.number().int().min(1).max(6).optional().describe('Grid column count.'),
});

const composeTaskSchema = z.object({
  tool: z.literal('compose-dashboard').describe('Task kind.'),
  dashboardName: z.string().trim().min(1).max(255).describe('Dashboard name.'),
  worksheetNames: z
    .array(z.string().trim().min(1).max(255))
    .min(1)
    .max(6)
    .describe('Rendered worksheet names.'),
  title: z.string().trim().min(1).max(255).optional().describe('Optional dashboard title.'),
  layout: layoutSchema.optional().describe('Optional dashboard layout.'),
});

const taskSchema = z.discriminatedUnion('tool', [applyTaskSchema, composeTaskSchema]);

const tasksSchema = z
  .array(taskSchema)
  .min(1)
  .max(7)
  .superRefine((tasks, context) => {
    const issue = dashboardBatchSequenceIssue(tasks);
    if (issue) context.addIssue({ code: 'custom', message: issue });
  })
  .describe('Ordered worksheet mutations followed by one dashboard composition.');

const paramsSchema = {
  session: sessionParam({ max: 64 }),
  tasks: tasksSchema,
};

export type RunDashboardBatchTask = z.output<typeof taskSchema>;

type AppliedState = true | false | 'partial' | 'unknown';

type StepReceipt =
  | {
      index: number;
      tool: 'apply-worksheet';
      artifactId: string;
      state: 'applied';
      retrySafe: false;
      title: string;
      verification: { ok: boolean; status: 'passed' | 'warning'; message?: string };
    }
  | {
      index: number;
      tool: 'apply-worksheet';
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
      tool: 'compose-dashboard';
      dashboardName: string;
      state: 'applied';
      retrySafe: false;
      worksheets: string[];
      replaced: boolean;
      verification: { status: 'passed'; issues: [] };
    }
  | {
      index: number;
      tool: 'compose-dashboard';
      dashboardName: string;
      state: 'failed' | 'partial' | 'unknown';
      retrySafe: boolean;
      stage: string;
      error: string;
    }
  | {
      index: number;
      tool: RunDashboardBatchTask['tool'];
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

const title = 'Build dashboard views';
const MAX_UNEXPECTED_ERROR_LENGTH = 500;

export const getRunDashboardBatchTool = (
  server: DesktopMcpServer,
  dependencies: { store?: TemplateArtifactStore } = {},
): DesktopTool<typeof paramsSchema> => {
  const artifactStore = dependencies.store ?? getTemplateArtifactStore(server);
  const tool = new DesktopTool({
    server,
    name: 'run-dashboard-batch' as DesktopToolName,
    title,
    description: 'Apply prepared worksheets in order, then compose one dashboard.',
    paramsSchema,
    annotations: {
      readOnlyHint: false,
      openWorldHint: false,
      destructiveHint: true,
      idempotentHint: false,
    },
    callback: async ({ session, tasks }, extra): Promise<CallToolResult> => {
      return await tool.logAndExecute<RunDashboardBatchResult>({
        extra,
        args: { session, tasks },
        callback: async (): Promise<Result<RunDashboardBatchResult, McpToolError>> => {
          const sequenceIssue = dashboardBatchSequenceIssue(tasks);
          if (sequenceIssue) return new ArgsValidationError(sequenceIssue).toErr();

          const sessionResult = resolveSession(session);
          if (sessionResult.isErr()) return sessionResult.error.toErr();
          const resolvedSession = sessionResult.value;
          const executor = await extra.getExecutor(resolvedSession);
          const steps: StepReceipt[] = [];
          let successfulMutations = 0;

          for (const [index, task] of tasks.entries()) {
            if (extra.signal.aborted) {
              steps.push(abortedReceipt(task, index));
              appendSkippedSteps(steps, tasks, index + 1, `stopped after task ${index} aborted`);
              return incomplete({
                applied: successfulMutations > 0 ? 'partial' : false,
                retrySafe: successfulMutations === 0,
                steps,
              });
            }

            if (task.tool === 'apply-worksheet') {
              let outcome: Awaited<ReturnType<typeof applyWorksheetArtifact>>;
              try {
                outcome = await applyWorksheetArtifact({
                  store: artifactStore,
                  artifactId: task.artifactId,
                  sessionId: resolvedSession,
                  executor,
                  signal: extra.signal,
                });
              } catch (error) {
                steps.push({
                  index,
                  tool: task.tool,
                  artifactId: task.artifactId,
                  state: 'unknown',
                  retrySafe: false,
                  error: boundedUnexpectedError(error),
                });
                appendSkippedSteps(
                  steps,
                  tasks,
                  index + 1,
                  `stopped after task ${index} ended unexpectedly`,
                );
                return incomplete({ applied: 'unknown', retrySafe: false, steps });
              }

              if (outcome.state === 'applied') {
                successfulMutations += 1;
                const { verification } = outcome.receipt;
                if (verification.status === 'failed' || verification.status === 'skipped') {
                  steps.push({
                    index,
                    tool: task.tool,
                    artifactId: task.artifactId,
                    state: 'unknown',
                    retrySafe: false,
                    title: outcome.receipt.title,
                    verification: {
                      ok: verification.ok,
                      status: verification.status,
                      ...(verification.message ? { message: verification.message } : {}),
                    },
                  });
                  appendSkippedSteps(
                    steps,
                    tasks,
                    index + 1,
                    `stopped after task ${index} could not be verified`,
                  );
                  return incomplete({ applied: 'unknown', retrySafe: false, steps });
                }

                steps.push({
                  index,
                  tool: task.tool,
                  artifactId: task.artifactId,
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
                tool: task.tool,
                artifactId: task.artifactId,
                state: outcome.state,
                retrySafe: outcome.retrySafe,
                error: outcome.error.getErrorText(),
              });
              appendSkippedSteps(steps, tasks, index + 1, `stopped after task ${index} failed`);
              if (outcome.state === 'unknown') {
                return incomplete({ applied: 'unknown', retrySafe: false, steps });
              }
              return incomplete({
                applied: successfulMutations > 0 ? 'partial' : false,
                retrySafe: successfulMutations === 0 && outcome.retrySafe,
                steps,
              });
            }

            let outcome: Awaited<ReturnType<typeof composeDashboardCore>>;
            try {
              outcome = await composeDashboardCore({
                dashboardName: task.dashboardName,
                worksheetNames: task.worksheetNames,
                title: task.title,
                layout: task.layout,
                executor,
                signal: extra.signal,
              });
            } catch (error) {
              steps.push({
                index,
                tool: task.tool,
                dashboardName: task.dashboardName,
                state: 'unknown',
                retrySafe: false,
                stage: 'unexpected-error',
                error: boundedUnexpectedError(error),
              });
              appendSkippedSteps(
                steps,
                tasks,
                index + 1,
                `stopped after task ${index} ended unexpectedly`,
              );
              return incomplete({ applied: 'unknown', retrySafe: false, steps });
            }
            if (outcome.state === 'applied') {
              successfulMutations += 1;
              steps.push({
                index,
                tool: task.tool,
                dashboardName: task.dashboardName,
                state: 'applied',
                retrySafe: false,
                worksheets: outcome.receipt.worksheets,
                replaced: outcome.receipt.replaced,
                verification: outcome.receipt.verification,
              });
              continue;
            }

            steps.push({
              index,
              tool: task.tool,
              dashboardName: task.dashboardName,
              state: outcome.state,
              retrySafe: outcome.retrySafe,
              stage: outcome.stage,
              error: outcome.error.getErrorText(),
            });
            if (outcome.state === 'unknown') {
              return incomplete({ applied: 'unknown', retrySafe: false, steps });
            }
            if (outcome.state === 'partial') {
              return incomplete({ applied: 'partial', retrySafe: false, steps });
            }
            return incomplete({
              applied: successfulMutations > 0 ? 'partial' : false,
              retrySafe: successfulMutations === 0 && outcome.retrySafe,
              steps,
            });
          }

          return Ok({ applied: true, retrySafe: false, steps });
        },
        getSuccessResult: (result) => jsonToolResult(result, { isError: false }),
      });
    },
  });

  return tool;
};

function dashboardBatchSequenceIssue(tasks: readonly RunDashboardBatchTask[]): string | undefined {
  const composeIndexes = tasks.flatMap((task, index) =>
    task.tool === 'compose-dashboard' ? [index] : [],
  );
  if (composeIndexes.length !== 1) {
    return 'The batch must contain exactly one dashboard composition task.';
  }
  if (composeIndexes[0] !== tasks.length - 1) {
    return 'The dashboard composition task must be last.';
  }
  const applyCount = tasks.filter((task) => task.tool === 'apply-worksheet').length;
  if (applyCount > 6) return 'The batch accepts at most six worksheet artifact tasks.';
  return undefined;
}

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

function abortedReceipt(task: RunDashboardBatchTask, index: number): StepReceipt {
  return {
    index,
    tool: task.tool,
    ...(task.tool === 'apply-worksheet'
      ? { artifactId: task.artifactId }
      : { dashboardName: task.dashboardName }),
    state: 'aborted',
    retrySafe: true,
    reason: 'The request was aborted before this task started.',
  };
}

function appendSkippedSteps(
  steps: StepReceipt[],
  tasks: readonly RunDashboardBatchTask[],
  startIndex: number,
  reason: string,
): void {
  for (let index = startIndex; index < tasks.length; index += 1) {
    const task = tasks[index]!;
    steps.push({
      index,
      tool: task.tool,
      ...(task.tool === 'apply-worksheet'
        ? { artifactId: task.artifactId }
        : { dashboardName: task.dashboardName }),
      state: 'skipped',
      retrySafe: true,
      reason,
    });
  }
}
