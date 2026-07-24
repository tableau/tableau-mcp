import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { getConfig } from '../../../../config.js';
import { McpToolError } from '../../../../errors/mcpToolError.js';
import { useRestApi } from '../../../../restApiInstance.js';
import { RunFlowJob } from '../../../../sdks/tableau/types/job.js';
import { WebMcpServer } from '../../../../server.web.js';
import { WebTool } from '../../tool.js';
import { mapFlowWriteError } from '../flowWriteErrors.js';

const paramsSchema = {
  taskId: z.string().nonempty(),
};

export type RunFlowTaskResult = {
  job: RunFlowJob;
  mcp: {
    runStatus: string;
  };
};

export const getRunFlowTaskTool = (server: WebMcpServer): WebTool<typeof paramsSchema> => {
  const config = getConfig();
  const runFlowTaskTool = new WebTool({
    server,
    name: 'run-flow-task',
    // Write tools require the base flow tool gate as well as their own
    // explicit opt-in, so write cannot be enabled without read-only flow tools.
    disabled: !config.flowToolsEnabled || !config.flowWriteToolsEnabled,
    description: `
  Runs an **existing scheduled flow run task** now ("Run Now" on a schedule), by task id. The task runs with the output steps and parameters it was configured with; a suspended task is resumed. This ENQUEUES the run and returns immediately with an async job — the run is NOT finished when this tool returns.

  Choose this tool over \`run-flow\` when the user wants to trigger a flow's **existing schedule/task** right now (you have a *task id* from \`list-flow-tasks\`), rather than an ad-hoc run with caller-chosen output steps (\`run-flow\`, which takes a *flow id*).

  **This tool changes server state** (it runs the flow, consuming Prep Conductor capacity and overwriting outputs). Only call it when the user asks to run the task.

  **Parameters:**
  - \`taskId\` (required) – The flow run task id from \`list-flow-tasks\` (the task \`id\`, i.e. the flowRun id).

  **Response:** \`{ job, mcp: { runStatus } }\` — \`job.id\` (background job id) and \`job.runFlowJobType.flowRunId\`. Asynchronous: report it as *started*, then poll \`list-flow-runs\` / \`get-flow\` for the outcome.

  **Requirements & limits:**
  - Requires **Data Management with Tableau Prep Conductor**; the site's **Run Now** setting must be enabled.
  - **Caller-role:** non-administrators can only run flow run tasks they own.
  - Not idempotent. If a run for the task is already queued/in progress the request may be rejected.
  - **Bounded-context note:** when this MCP server is restricted to specific projects/tags, this tool cannot verify that a task's flow is in the allowed set (a task carries no project/tag and is addressed only by task id), so it refuses. Use \`run-flow\` (by flow id) in that configuration.
  - Requires Tableau REST API access scopes \`tableau:flow_tasks:run\` and \`tableau:mcp_site_settings:read\`.`,
    paramsSchema,
    annotations: {
      title: 'Run Flow Task',
      readOnlyHint: false,
      // Running the task overwrites the flow's configured outputs, so clients
      // should treat this state-changing operation as destructive.
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
    callback: async ({ taskId }, extra): Promise<CallToolResult> => {
      return await runFlowTaskTool.logAndExecute<RunFlowTaskResult>({
        extra,
        args: { taskId },
        callback: async () => {
          // Fail closed under a bounded context. A flow run task has no project
          // or tag and is addressed only by task id, so (exactly like
          // list-flow-tasks) we cannot prove the underlying flow belongs to the
          // allowed set. Refuse rather than risk running a flow outside scope.
          const { boundedContext } = await extra.getConfigWithOverrides();
          if (boundedContext.projectIds || boundedContext.tags) {
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
            const job = await useRestApi({
              ...extra,
              jwtScopes: runFlowTaskTool.requiredApiScopes,
              callback: async (restApi) =>
                restApi.tasksMethods.runFlowTask({
                  siteId: restApi.siteId,
                  taskId,
                }),
            });

            return new Ok({
              job,
              mcp: {
                runStatus:
                  'The flow run task has been queued and is running asynchronously. Use list-flow-runs or get-flow to check its status.',
              },
            } satisfies RunFlowTaskResult);
          } catch (error) {
            return mapFlowWriteError(error, 'run this flow task').toErr();
          }
        },
        constrainSuccessResult: (result) => ({ type: 'success', result }),
      });
    },
  });

  return runFlowTaskTool;
};

export const exportedForTesting = {
  runFlowTaskParamsSchema: paramsSchema,
};
