import { CallToolResult } from '@modelcontextprotocol/server';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { getConfig } from '../../../../config.js';
import { McpToolError } from '../../../../errors/mcpToolError.js';
import { isFlowWriteToolsEnabled } from '../../../../features/flowTools.js';
import { useRestApi } from '../../../../restApiInstance.js';
import { luidSchema } from '../../../../sdks/routeSafety/ids.js';
import { RestApi } from '../../../../sdks/tableau/restApi.js';
import { RunFlowJob } from '../../../../sdks/tableau/types/job.js';
import { SiteRole } from '../../../../sdks/tableau/types/user.js';
import { WebMcpServer } from '../../../../server.web.js';
import { Provider } from '../../../../utils/provider.js';
import { readPreState } from '../../_lib/preStateRead.js';
import { SignedConfirmation } from '../../_lib/signedConfirmation.js';
import { WebTool } from '../../tool.js';
import { FLOW_RUNS_READ_SCOPE, resolveFlowRunPreState } from '../flowRunPreState.js';
import { mapFlowWriteError } from '../flowWriteErrors.js';

const paramsSchema = {
  taskId: luidSchema,
  confirm: z.boolean().optional(),
  confirmationToken: z.string().optional(),
};

export type RunFlowTaskResult =
  | {
      job: RunFlowJob;
      mcp: {
        runStatus: string;
      };
    }
  | string;

export const getRunFlowTaskTool = (server: WebMcpServer): WebTool<typeof paramsSchema> => {
  const config = getConfig();
  const runFlowTaskTool = new WebTool({
    server,
    name: 'run-flow-task',
    minRequiredRole: SiteRole.EXPLORER_CAN_PUBLISH,
    disabled: new Provider(async () => !(await isFlowWriteToolsEnabled(config))),
    description: `
  Runs an **existing scheduled flow run task** now ("Run Now" on a schedule), by task id. The task runs with the output steps and parameters it was configured with; a suspended task is resumed. This ENQUEUES the run and returns immediately with an async job — the run is NOT finished when this tool returns.

  Choose this tool over \`run-flow\` when the user wants to trigger a flow's **existing schedule/task** right now (you have a *task id* from \`list-flow-tasks\`), rather than an ad-hoc run with caller-chosen output steps (\`run-flow\`, which takes a *flow id*).

  **This tool changes server state** (it runs the flow, consuming Prep Conductor capacity and overwriting outputs). Only call it when the user asks to run the task.

  **Two-phase confirmation:**
  1. **Preview** (\`confirm\` omitted or false): describes the task run without enqueuing it and returns a short-lived confirmation token bound to this change.
  2. **Run** (\`confirm: true\`): requires the token from the matching preview before enqueuing the task, and rejects it if a new run of the task's flow appeared since the preview.

  **Parameters:**
  - \`taskId\` (required) – The flow run task id from \`list-flow-tasks\` (the task \`id\`, i.e. the flowRun id).
  - \`confirm\` (optional) – Set \`true\` only after the user approves the preview.
  - \`confirmationToken\` (optional) – The token returned by the matching preview. Required when \`confirm\` is true.

  **Response:** Preview returns instructions and a confirmation token. A confirmed call returns \`{ job, mcp: { runStatus } }\` — \`job.id\` (background job id) and \`job.runFlowJobType.flowRunId\`. Asynchronous: report it as *started*, then poll \`list-flow-runs\` / \`get-flow\` for the outcome.

  **Requirements & limits:**
  - Requires **Data Management with Tableau Prep Conductor**; the site's **Run Now** setting must be enabled.
  - **Caller-role:** non-administrators can only run flow run tasks they own.
  - Not idempotent. If a run for the task is already queued/in progress the request may be rejected.
  - **Bounded-context note:** when this MCP server is restricted to specific projects/tags, this tool cannot verify that a task's flow is in the allowed set (a task carries no project/tag and is addressed only by task id), so it refuses. Use \`run-flow\` (by flow id) in that configuration.
  - Requires Tableau REST API access scopes \`tableau:flow_tasks:run\`, \`tableau:flow_tasks:read\` and \`tableau:flow_runs:read\` (to bind the token to the task's flow and its latest runs), and \`tableau:mcp_site_settings:read\`.`,
    paramsSchema,
    annotations: {
      title: 'Run Flow Task',
      readOnlyHint: false,
      // Running a task can overwrite configured outputs.
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
    callback: async ({ taskId, confirm, confirmationToken }, extra): Promise<CallToolResult> => {
      return await runFlowTaskTool.logAndExecute<RunFlowTaskResult>({
        extra,
        args: {
          taskId,
          ...(confirm === undefined ? {} : { confirm }),
          ...(confirmationToken ? { confirmationToken: '<redacted>' } : {}),
        },
        callback: async () => {
          // Run Flow Task is supported on all REST versions (REST 3.3+); no version preflight needed.
          const { boundedContext } = await extra.getConfigWithOverrides();
          if (boundedContext.projectIds || boundedContext.tags) {
            // A flow run task has no project/tag, so bounded contexts cannot prove it is in scope.
            return new McpToolError({
              type: 'flow-task-not-allowed',
              statusCode: 403,
              message: [
                'This MCP server is restricted to an allowed set of projects or tags.',
                'A flow run task is not associated with a project or tag, so this tool cannot verify that the task belongs to the allowed set and will not run a task under this configuration.',
                'Use run-flow with a flow id instead.',
              ].join(' '),
            }).toErr();
          }

          try {
            const result = await useRestApi({
              ...extra,
              jwtScopes: runFlowTaskTool.requiredApiScopes,
              callback: async (restApi) => {
                // Server-signed, short-lived token bound to site, user, tool and task (binding =
                // taskId), plus the pre-state of the task's flow: its newest runs. The flow id is
                // resolved from the task (one extra Get Flow Run Task call) on preview AND confirm, so
                // a task re-pointed at another flow, or a new run of the flow, rejects the confirm.
                // Any lookup failure fails closed.
                const confirmation = new SignedConfirmation({
                  tool: 'run-flow-task',
                  targetId: taskId,
                  targetKind: 'flow run task',
                  binding: taskId,
                  resolveState: () => resolveFlowRunTaskPreState(restApi, taskId),
                  text: {
                    subject: 'present this proposed task run',
                    approvalClause: 'confirm it. Do NOT run',
                    tail: ' before starting the task run).',
                  },
                });
                const caller = { restApi, userLuid: extra.getUserLuid() };

                if (!confirm) {
                  return (
                    `Preview — would enqueue the existing flow run task '${taskId}'. ` +
                    'No flow run has been started. ' +
                    (await confirmation.preview(caller))
                  );
                }

                const job = await confirmation.confirmAndRun(caller, confirmationToken, () =>
                  restApi.tasksMethods.runFlowTask({
                    siteId: restApi.siteId,
                    taskId,
                  }),
                );
                return {
                  job,
                  mcp: {
                    runStatus:
                      'The flow run task has been queued and is running asynchronously. Use list-flow-runs or get-flow to check its status.',
                  },
                } satisfies RunFlowTaskResult;
              },
            });

            return new Ok(result);
          } catch (error) {
            return mapFlowWriteError(
              error,
              confirm ? 'run this flow task' : 'preview this flow task',
            ).toErr();
          }
        },
        constrainSuccessResult: (result) => ({ type: 'success', result }),
      });
    },
  });

  return runFlowTaskTool;
};

/**
 * Pre-state for a task run: the task's flow id plus that flow's newest runs (resolveFlowRunPreState).
 * Throws (fail closed) when the task or its flow cannot be resolved. A 401/403 on the task read names
 * tableau:flow_tasks:read (both pre-state scopes, since the runs read follows), and on the runs read
 * names tableau:flow_runs:read (see preStateRead.ts).
 */
async function resolveFlowRunTaskPreState(restApi: RestApi, taskId: string): Promise<string> {
  const task = await readPreState(
    () => restApi.tasksMethods.getFlowRunTask({ siteId: restApi.siteId, taskId }),
    {
      description: "this flow task and its flow's recent runs",
      requiredScopes: ['tableau:flow_tasks:read', FLOW_RUNS_READ_SCOPE],
    },
  );
  const flowId = task.flow?.id;
  if (!flowId) {
    throw new McpToolError({
      type: 'flow-task-flow-unresolved',
      statusCode: 409,
      message: `Could not resolve the flow for flow run task '${taskId}', so the run cannot be confirmed safely. Verify the task id with list-flow-tasks and preview again.`,
    });
  }
  return await resolveFlowRunPreState(restApi, flowId);
}

export const exportedForTesting = {
  runFlowTaskParamsSchema: paramsSchema,
};
