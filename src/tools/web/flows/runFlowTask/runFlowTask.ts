import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { getConfig } from '../../../../config.js';
import { McpToolError, PreviewNotRunError } from '../../../../errors/mcpToolError.js';
import { getFeatureGate } from '../../../../features/init.js';
import { useRestApi } from '../../../../restApiInstance.js';
import { RunFlowJob } from '../../../../sdks/tableau/types/job.js';
import { SiteRole } from '../../../../sdks/tableau/types/user.js';
import { WebMcpServer } from '../../../../server.web.js';
import { Provider } from '../../../../utils/provider.js';
import { EvidenceContext, RegistryEvidence } from '../../_lib/evidence.js';
import { renderPreviewNotRunMessage, renderTokenConfirmNextStep } from '../../_lib/hitlText.js';
import { WebTool } from '../../tool.js';
import { mapFlowWriteError } from '../flowWriteErrors.js';

const paramsSchema = {
  taskId: z.string().nonempty(),
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
    // Requires the base flow gate, write opt-in, and flow-tools feature flag.
    disabled: new Provider(
      async () =>
        !config.flowToolsEnabled ||
        !config.flowWriteToolsEnabled ||
        !(await getFeatureGate().isFeatureEnabled('flow-tools')),
    ),
    description: `
  Runs an **existing scheduled flow run task** now ("Run Now" on a schedule), by task id. The task runs with the output steps and parameters it was configured with; a suspended task is resumed. This ENQUEUES the run and returns immediately with an async job — the run is NOT finished when this tool returns.

  Choose this tool over \`run-flow\` when the user wants to trigger a flow's **existing schedule/task** right now (you have a *task id* from \`list-flow-tasks\`), rather than an ad-hoc run with caller-chosen output steps (\`run-flow\`, which takes a *flow id*).

  **This tool changes server state** (it runs the flow, consuming Prep Conductor capacity and overwriting outputs). Only call it when the user asks to run the task.

  **Two-phase confirmation:**
  1. **Preview** (\`confirm\` omitted or false): describes the task run without enqueuing it and returns a single-use confirmation token.
  2. **Run** (\`confirm: true\`): requires the token from the matching preview before enqueuing the task.

  **Parameters:**
  - \`taskId\` (required) – The flow run task id from \`list-flow-tasks\` (the task \`id\`, i.e. the flowRun id).
  - \`confirm\` (optional) – Set \`true\` only after the user approves the preview.
  - \`confirmationToken\` (optional) – The single-use token returned by the matching preview. Required when \`confirm\` is true.

  **Response:** Preview returns instructions and a confirmation token. A confirmed call returns \`{ job, mcp: { runStatus } }\` — \`job.id\` (background job id) and \`job.runFlowJobType.flowRunId\`. Asynchronous: report it as *started*, then poll \`list-flow-runs\` / \`get-flow\` for the outcome.

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
                const evidence = new RegistryEvidence();
                const evidenceContext: EvidenceContext = {
                  restApi,
                  siteId: restApi.siteId,
                  target: { id: taskId },
                  tool: 'run-flow-task',
                  userLuid: extra.getUserLuid(),
                  confirmationToken,
                  binding: taskId,
                };

                if (!confirm) {
                  await evidence.establish(evidenceContext);
                  return (
                    `Preview — would enqueue the existing flow run task '${taskId}'. ` +
                    'No flow run has been started. ' +
                    renderTokenConfirmNextStep({
                      subject: 'present this proposed task run',
                      approvalClause: 'confirm it. Do NOT run',
                      nonce: evidence.getEstablishedNonce(),
                      tail: ' before starting the task run).',
                    })
                  );
                }

                if (!(await evidence.verify(evidenceContext))) {
                  throw new PreviewNotRunError(
                    renderPreviewNotRunMessage({
                      tool: 'run-flow-task',
                      targetKind: 'flow run task',
                      targetId: taskId,
                    }),
                  );
                }

                const job = await restApi.tasksMethods.runFlowTask({
                  siteId: restApi.siteId,
                  taskId,
                });
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

export const exportedForTesting = {
  runFlowTaskParamsSchema: paramsSchema,
};
