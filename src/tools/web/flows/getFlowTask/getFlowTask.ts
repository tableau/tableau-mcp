import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { getConfig } from '../../../../config.js';
import { McpToolError } from '../../../../errors/mcpToolError.js';
import { useRestApi } from '../../../../restApiInstance.js';
import { FlowRunTask } from '../../../../sdks/tableau/types/flowRunTask.js';
import { WebMcpServer } from '../../../../server.web.js';
import { getExceptionMessage } from '../../../../utils/getExceptionMessage.js';
import { getHttpStatus } from '../../../../utils/getHttpStatus.js';
import { WebTool } from '../../tool.js';
import { extractTableauError, formatTableauError } from '../flowWriteErrors.js';

const paramsSchema = {
  taskId: z.string().nonempty(),
};

export type GetFlowTaskResult = {
  flowTask: FlowRunTask;
};

export const getGetFlowTaskTool = (server: WebMcpServer): WebTool<typeof paramsSchema> => {
  const config = getConfig();
  const getFlowTaskTool = new WebTool({
    server,
    name: 'get-flow-task',
    disabled: !config.flowToolsEnabled,
    description: `
  Retrieves a single scheduled flow run task (the **schedule** for a Tableau Prep flow) by its task id. A flow run task describes when/how often a flow is configured to run — NOT a record of past executions (for run history use \`list-flow-runs\`).

  Prefer this tool over \`list-flow-tasks\` when you already have a task id (e.g. from a previous \`list-flow-tasks\` call): it is a direct, cheap fetch, whereas \`list-flow-tasks\` has no server-side filtering and must retrieve **every** task on the site before filtering. Use \`list-flow-tasks\` only when you need to discover/enumerate tasks.

  **Parameters:**
  - \`taskId\` (required) – The flow run task id (the task \`id\` from \`list-flow-tasks\`).

  **Response:** \`{ flowTask }\` — the task includes \`id\`, \`flow\` (\`id\`, \`name\`), \`schedule\` (frequency, nextRunAt, state, timestamps), \`priority\`, \`consecutiveFailedCount\`, and \`type\`.

  **Caller-role visibility:** non-administrators can only access flow run tasks for flows they own; administrators can access any flow run task on the site.

  **Note:** Requires Tableau REST API access scope \`tableau:flow_tasks:read\`. When this server is restricted to specific projects/tags, this tool cannot verify that a task's flow is in the allowed set (a task carries no project/tag) and will refuse — use \`get-flow\` (by flow id) to inspect a specific flow under that configuration.`,
    paramsSchema,
    annotations: {
      title: 'Get Flow Task',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    callback: async ({ taskId }, extra): Promise<CallToolResult> => {
      return await getFlowTaskTool.logAndExecute<GetFlowTaskResult>({
        extra,
        args: { taskId },
        callback: async () => {
          // Fail closed under a PROJECT_IDS / TAGS bounded context (mirrors
          // list-flow-tasks): a flow run task has no project or tag and is
          // addressed only by task id, so we cannot prove the underlying flow
          // belongs to the allowed set. Refuse rather than risk leaking a
          // schedule for a flow outside the allow-list.
          const { boundedContext } = await extra.getConfigWithOverrides();
          if (boundedContext.projectIds || boundedContext.tags) {
            return new McpToolError({
              type: 'flow-task-not-allowed',
              statusCode: 403,
              message: [
                'This MCP server is restricted to an allowed set of projects or tags.',
                'A flow run task is not associated with a project or tag, so this tool cannot verify that the task belongs to the allowed set and will not return a flow task under this configuration.',
              ].join(' '),
            }).toErr();
          }

          try {
            const flowTask = await useRestApi({
              ...extra,
              jwtScopes: getFlowTaskTool.requiredApiScopes,
              callback: async (restApi) =>
                restApi.tasksMethods.getFlowRunTask({
                  siteId: restApi.siteId,
                  taskId,
                }),
            });

            return new Ok({ flowTask } satisfies GetFlowTaskResult);
          } catch (error) {
            return mapGetFlowTaskError(error).toErr();
          }
        },
        constrainSuccessResult: (result) => ({ type: 'success', result }),
      });
    },
  });

  return getFlowTaskTool;
};

function mapGetFlowTaskError(error: unknown): McpToolError {
  if (error instanceof McpToolError) {
    return error;
  }

  const status = error instanceof Error ? getHttpStatus(error) : '';
  const tableauError = extractTableauError(error);
  const cause = tableauError ? formatTableauError(tableauError) : getExceptionMessage(error);

  if (status === '403') {
    return new McpToolError({
      type: 'flow-task-forbidden',
      statusCode: 403,
      message: [
        'Not permitted to read this flow task.',
        'Non-administrators can only access scheduled flow run tasks for flows they own.',
        cause,
      ].join(' '),
    });
  }

  if (status === '404') {
    return new McpToolError({
      type: 'flow-task-not-found',
      statusCode: 404,
      message: [
        'Could not find this flow task, or you do not have access to it.',
        'Verify the task id with list-flow-tasks.',
        cause,
      ].join(' '),
    });
  }

  return new McpToolError({
    type: 'flow-task-read-failed',
    statusCode: Number(status) || 500,
    message: `Could not read this flow task: ${cause}`,
  });
}

export const exportedForTesting = {
  getFlowTaskParamsSchema: paramsSchema,
};
