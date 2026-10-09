import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { getConfig } from '../../../../config.js';
import { McpToolError, PreviewNotRunError } from '../../../../errors/mcpToolError.js';
import { getFeatureGate } from '../../../../features/init.js';
import { useRestApi } from '../../../../restApiInstance.js';
import { RestApi } from '../../../../sdks/tableau/restApi.js';
import { SiteRole } from '../../../../sdks/tableau/types/user.js';
import { WebMcpServer } from '../../../../server.web.js';
import { Provider } from '../../../../utils/provider.js';
import { EvidenceContext, RegistryEvidence } from '../../_lib/evidence.js';
import { renderPreviewNotRunMessage, renderTokenConfirmNextStep } from '../../_lib/hitlText.js';
import { WebTool } from '../../tool.js';
import { mapCancelFlowRunError } from '../flowWriteErrors.js';

const MIN_CANCEL_FLOW_RUN_REST_VERSION = '3.10';

const paramsSchema = {
  flowRunId: z.string().nonempty(),
  confirm: z.boolean().optional(),
  confirmationToken: z.string().optional(),
};

export type CancelFlowRunResult =
  | {
      mcp: {
        cancelStatus: string;
      };
    }
  | string;

export const getCancelFlowRunTool = (server: WebMcpServer): WebTool<typeof paramsSchema> => {
  const config = getConfig();
  const cancelFlowRunTool = new WebTool({
    server,
    name: 'cancel-flow-run',
    minRequiredRole: SiteRole.EXPLORER_CAN_PUBLISH,
    // Requires the base flow gate, write opt-in, and flow-tools feature flag.
    disabled: new Provider(
      async () =>
        !config.flowToolsEnabled ||
        !config.flowWriteToolsEnabled ||
        !(await getFeatureGate().isFeatureEnabled('flow-tools')),
    ),
    description: `
  Requests cancellation of a **queued or in-progress Tableau Prep flow run**, by flow *run* id (not flow id). This is the counterpart to \`run-flow\` / \`run-flow-task\`: use it for a run you started that has not reached a terminal state. The request may be accepted while the run is executing, but the final status can still be Completed or Failed if the run is already finishing.

  Get the \`flowRunId\` from \`run-flow\` / \`run-flow-task\` (\`job.runFlowJobType.flowRunId\`) or from \`list-flow-runs\`. To only inspect runs, use \`list-flow-runs\` / \`get-flow\` (read-only).

  **This tool changes server state.** Cancellation is **asynchronous**:
  - The cancellation request may take several seconds to settle while the server reconciles the run's terminal status.
  - If the run is already in its **final output-write phase**, those writes may complete and the final status may be Completed or Failed rather than Cancelled. Cancellation does not undo writes.
  - It does **not** alter the flow definition or its schedule — it requests cancellation for one run.

  **Two-phase confirmation:**
  1. **Preview** (\`confirm\` omitted or false): describes the cancellation request without contacting Tableau and returns a single-use confirmation token.
  2. **Cancel** (\`confirm: true\`): requires the token from the matching preview before requesting cancellation.

  **Parameters:**
  - \`flowRunId\` (required) – The id of the flow run to cancel.
  - \`confirm\` (optional) – Set \`true\` only after the user approves the preview.
  - \`confirmationToken\` (optional) – The single-use token returned by the matching preview. Required when \`confirm\` is true.

  **Response:** Preview returns instructions and a confirmation token. A confirmed call returns \`{ mcp: { cancelStatus } }\`. Report the cancel as *requested*. Use \`list-flow-runs\` to confirm the final status; retain the associated flow id when narrowing the query.

  **Requirements & limits:**
  - **Caller-role:** in addition to site/server administrators, you can cancel a flow run only if you **initiated the run** (or created its scheduled task) **and** have Run Flow permission on the flow. Non-permitted callers get a clear permission error.
  - Requires Tableau REST API version **3.10 or later**.
  - Fails if the run has **already completed** (nothing to cancel), or if a site administrator has **disabled flow-run cancellation** for the site.
  - **Bounded-context note:** when this MCP server is restricted to specific projects/tags, this tool cannot verify that the flow run's flow is in the allowed set (a run is addressed only by run id), so it refuses — mirroring \`run-flow-task\`.
  - Requires Tableau REST API access scopes \`tableau:flow_runs:update\` and \`tableau:mcp_site_settings:read\`.`,
    paramsSchema,
    annotations: {
      title: 'Cancel Flow Run',
      readOnlyHint: false,
      // Cancellation can leave final output writes applied.
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
    callback: async ({ flowRunId, confirm, confirmationToken }, extra): Promise<CallToolResult> => {
      return await cancelFlowRunTool.logAndExecute<CancelFlowRunResult>({
        extra,
        args: {
          flowRunId,
          ...(confirm === undefined ? {} : { confirm }),
          ...(confirmationToken ? { confirmationToken: '<redacted>' } : {}),
        },
        callback: async () => {
          if (!RestApi.versionIsAtLeast(MIN_CANCEL_FLOW_RUN_REST_VERSION)) {
            return new McpToolError({
              type: 'cancel-flow-run-version-unsupported',
              statusCode: 400,
              message: `Cancel Flow Run requires Tableau REST API version ${MIN_CANCEL_FLOW_RUN_REST_VERSION} or later.`,
            }).toErr();
          }

          // A flow run has no project/tag, so bounded contexts cannot prove it is in scope.
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
            const result = await useRestApi({
              ...extra,
              jwtScopes: cancelFlowRunTool.requiredApiScopes,
              callback: async (restApi) => {
                const evidence = new RegistryEvidence();
                const evidenceContext: EvidenceContext = {
                  restApi,
                  siteId: restApi.siteId,
                  target: { id: flowRunId },
                  tool: 'cancel-flow-run',
                  userLuid: extra.getUserLuid(),
                  confirmationToken,
                  binding: flowRunId,
                };

                if (!confirm) {
                  await evidence.establish(evidenceContext);
                  return (
                    `Preview — would request cancellation of flow run '${flowRunId}'. ` +
                    'No cancellation has been requested. ' +
                    renderTokenConfirmNextStep({
                      subject: 'present this proposed cancellation',
                      approvalClause: 'confirm it. Do NOT cancel',
                      nonce: evidence.getEstablishedNonce(),
                      tail: ' before requesting cancellation).',
                    })
                  );
                }

                if (!(await evidence.verify(evidenceContext))) {
                  throw new PreviewNotRunError(
                    renderPreviewNotRunMessage({
                      tool: 'cancel-flow-run',
                      targetKind: 'flow run',
                      targetId: flowRunId,
                    }),
                  );
                }

                await restApi.flowsMethods.cancelFlowRun({
                  siteId: restApi.siteId,
                  flowRunId,
                });
                return {
                  mcp: {
                    cancelStatus:
                      'Cancellation has been requested. The run may still finish as Completed or Failed while the request is being processed, especially during final output writes. Use list-flow-runs or get-flow to confirm the final status.',
                  },
                } satisfies CancelFlowRunResult;
              },
            });

            return new Ok(result);
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
