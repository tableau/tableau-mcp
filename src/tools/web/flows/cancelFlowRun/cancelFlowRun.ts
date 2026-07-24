import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { getConfig } from '../../../../config.js';
import { McpToolError } from '../../../../errors/mcpToolError.js';
import { useRestApi } from '../../../../restApiInstance.js';
import { RestApi } from '../../../../sdks/tableau/restApi.js';
import { WebMcpServer } from '../../../../server.web.js';
import { WebTool } from '../../tool.js';
import { mapCancelFlowRunError } from '../flowWriteErrors.js';

const MIN_CANCEL_FLOW_RUN_REST_VERSION = '3.10';

const paramsSchema = {
  flowRunId: z.string().nonempty(),
};

/**
 * Wrapped result: an `mcp.cancelStatus` note so the model reports the request as
 * *requested* (asynchronous) rather than claiming a guaranteed final state.
 */
export type CancelFlowRunResult = {
  mcp: {
    cancelStatus: string;
  };
};

export const getCancelFlowRunTool = (server: WebMcpServer): WebTool<typeof paramsSchema> => {
  const config = getConfig();
  const cancelFlowRunTool = new WebTool({
    server,
    name: 'cancel-flow-run',
    // Write tools require the base flow tool gate as well as their own
    // explicit opt-in, so write cannot be enabled without read-only flow tools.
    disabled: !config.flowToolsEnabled || !config.flowWriteToolsEnabled,
    description: `
  Requests cancellation of a **queued or in-progress Tableau Prep flow run**, by flow *run* id (not flow id). This is the counterpart to \`run-flow\` / \`run-flow-task\`: use it for a run you started that has not reached a terminal state. The request may be accepted while the run is executing, but the final status can still be Completed or Failed if the run is already finishing.

  Get the \`flowRunId\` from \`run-flow\` / \`run-flow-task\` (\`job.runFlowJobType.flowRunId\`) or from \`list-flow-runs\`. To only inspect runs, use \`list-flow-runs\` / \`get-flow\` (read-only).

  **This tool changes server state.** Cancellation is **asynchronous**:
  - The cancellation request may take several seconds to settle while the server reconciles the run's terminal status.
  - If the run is already in its **final output-write phase**, those writes may complete and the final status may be Completed or Failed rather than Cancelled. Cancellation does not undo writes.
  - It does **not** alter the flow definition or its schedule — it requests cancellation for one run.

  **Parameters:**
  - \`flowRunId\` (required) – The id of the flow run to cancel.

  **Response:** \`{ mcp: { cancelStatus } }\`. Report the cancel as *requested*, then confirm the final state with \`list-flow-runs\` (filter \`flowId:eq:<id>\`) or \`get-flow\`.

  **Requirements & limits:**
  - **Caller-role:** in addition to site/server administrators, you can cancel a flow run only if you **initiated the run** (or created its scheduled task) **and** have Run Flow permission on the flow. Non-permitted callers get a clear permission error.
  - Requires Tableau REST API version **3.10 or later**.
  - Fails if the run has **already completed** (nothing to cancel), or if a site administrator has **disabled flow-run cancellation** for the site.
  - **Bounded-context note:** when this MCP server is restricted to specific projects/tags, this tool cannot verify that the flow run's flow is in the allowed set (a run is addressed only by run id), so it refuses \u2014 mirroring \`run-flow-task\`.
  - Requires Tableau REST API access scopes \`tableau:flow_runs:update\` and \`tableau:mcp_site_settings:read\`.`,
    paramsSchema,
    annotations: {
      title: 'Cancel Flow Run',
      readOnlyHint: false,
      // Cancelling does not delete the flow, its schedule, or its definition,
      // but a cancellation request during final output writes can still leave
      // those writes applied, so we flag it as destructive to be honest with
      // clients.
      destructiveHint: true,
      // Not idempotent: cancelling an already-finished run returns a distinct
      // "already complete" error rather than silently succeeding.
      idempotentHint: false,
      openWorldHint: false,
    },
    callback: async ({ flowRunId }, extra): Promise<CallToolResult> => {
      return await cancelFlowRunTool.logAndExecute<CancelFlowRunResult>({
        extra,
        args: { flowRunId },
        callback: async () => {
          if (!RestApi.versionIsAtLeast(MIN_CANCEL_FLOW_RUN_REST_VERSION)) {
            return new McpToolError({
              type: 'cancel-flow-run-version-unsupported',
              statusCode: 400,
              message: `Cancel Flow Run requires Tableau REST API version ${MIN_CANCEL_FLOW_RUN_REST_VERSION} or later.`,
            }).toErr();
          }

          // Fail closed under a bounded context. A flow run is addressed only by
          // run id and carries no project or tag, so (exactly like
          // run-flow-task) we cannot prove the underlying flow belongs to the
          // allowed set. Refuse rather than risk cancelling a run outside scope.
          const { boundedContext } = await extra.getConfigWithOverrides();
          if (boundedContext.projectIds || boundedContext.tags) {
            return new McpToolError({
              type: 'flow-run-not-allowed',
              statusCode: 403,
              message: [
                'This MCP server is restricted to an allowed set of projects or tags.',
                'A flow run is not associated with a project or tag, so this tool cannot verify that the run belongs to the allowed set and will not cancel a run under this configuration.',
                'There is no flow-id-addressed alternative for cancellation, so do not retry — flow-run cancellation is unavailable while this server is bounded to specific projects or tags.',
              ].join(' '),
            }).toErr();
          }

          try {
            await useRestApi({
              ...extra,
              jwtScopes: cancelFlowRunTool.requiredApiScopes,
              callback: async (restApi) =>
                restApi.flowsMethods.cancelFlowRun({
                  siteId: restApi.siteId,
                  flowRunId,
                }),
            });

            return new Ok({
              mcp: {
                cancelStatus:
                  'Cancellation has been requested. The run may still finish as Completed or Failed while the request is being processed, especially during final output writes. Use list-flow-runs or get-flow to confirm the final status.',
              },
            } satisfies CancelFlowRunResult);
          } catch (error) {
            return mapCancelFlowRunError(error).toErr();
          }
        },
        constrainSuccessResult: (result) => ({ type: 'success', result }),
      });
    },
  });

  return cancelFlowRunTool;
};

export const exportedForTesting = {
  cancelFlowRunParamsSchema: paramsSchema,
};
