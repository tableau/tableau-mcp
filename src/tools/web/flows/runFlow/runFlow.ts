import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { getConfig } from '../../../../config.js';
import { FlowNotAllowedError, McpToolError } from '../../../../errors/mcpToolError.js';
import { useRestApi } from '../../../../restApiInstance.js';
import { RestApi } from '../../../../sdks/tableau/restApi.js';
import { RunFlowJob } from '../../../../sdks/tableau/types/job.js';
import { WebMcpServer } from '../../../../server.web.js';
import { resourceAccessChecker } from '../../resourceAccessChecker.js';
import { WebTool } from '../../tool.js';
import { mapFlowWriteError } from '../flowWriteErrors.js';

const MIN_RUN_FLOW_SPEC_REST_VERSION = '3.14';

const paramsSchema = {
  flowId: z.string().nonempty(),
  runMode: z.enum(['full', 'incremental']).optional(),
  outputStepIds: z
    .array(z.string().nonempty())
    .min(1, 'Provide at least one output step id, or omit outputStepIds to run all outputs.')
    .optional(),
  parameterOverrides: z
    .array(
      z.object({
        parameterId: z.string().nonempty(),
        overrideValue: z.string(),
      }),
    )
    .optional(),
};

/**
 * Wrapped result: the async `job` Tableau enqueued, plus an `mcp.runStatus`
 * note so the model never reports the run as finished.
 */
export type RunFlowResult = {
  job: RunFlowJob;
  mcp: {
    runStatus: string;
  };
};

export const getRunFlowTool = (server: WebMcpServer): WebTool<typeof paramsSchema> => {
  const config = getConfig();
  const runFlowTool = new WebTool({
    server,
    name: 'run-flow',
    // First-class content mutation: opt-in via FLOW_WRITE_TOOLS_ENABLED.
    // Write tools are only available when the base flow tool gate is on too.
    // This prevents the invalid "read-only flow tools off, write tools on"
    // configuration from exposing state-changing operations by themselves.
    disabled: !config.flowToolsEnabled || !config.flowWriteToolsEnabled,
    description: `
  Runs a Tableau Prep flow **on demand** ("Run Now"). This ENQUEUES a flow run on the server and returns immediately with an async job — the run is NOT finished when this tool returns. The flow executes its output steps (all of them unless you pass \`outputStepIds\`), writing to its configured outputs.

  Use this tool when the user explicitly wants to **run / refresh / execute** a specific flow right now (by flow id). To run an *existing schedule* now instead, use \`run-flow-task\`. To only inspect a flow or its runs, use \`get-flow\` / \`list-flow-runs\` (read-only).

  **This tool changes server state.** A run consumes warehouse + Tableau Prep Conductor capacity and overwrites the flow's outputs. Only run a flow when the user has asked for it.

  **Parameters:**
  - \`flowId\` (required) – The flow to run.
  - \`runMode\` (optional) – \`full\` (default) or \`incremental\`. Incremental only works if the flow's input steps are configured for incremental refresh.
  - \`outputStepIds\` (optional) – Run only these output steps (ids from \`get-flow\`). If provided, it must contain at least one id; omit it to run every output step.
  - \`parameterOverrides\` (optional) – Array of \`{ parameterId, overrideValue }\` for flows that use parameters. Required parameters must be supplied. Use \`get-flow\` to discover parameter ids and whether they are required.

  **Response:** \`{ job, mcp: { runStatus } }\`. \`job\` includes \`id\` (background job id) and \`runFlowJobType.flowRunId\` (the flow run id). The run is asynchronous: report it as *started/queued*, and to check the outcome poll with \`list-flow-runs\` (filter \`flowId:eq:<id>\`) or \`get-flow\` (\`flowRunLimit: 1\`).

  **Requirements & limits:**
  - Requires Tableau REST API version **3.14 or later**. Older Tableau Server versions use a legacy Run Flow request shape that this MCP tool does not send, so the tool refuses instead of risking silently ignored run options or unintended output steps.
  - Requires **Data Management with Tableau Prep Conductor**, and the site's **Run Now** setting must be enabled.
  - **Caller-role:** in addition to admins/project leaders, the flow owner and users granted Run Flow / Execute permission can run a flow. Non-permitted callers get a clear permission error.
  - Not idempotent — each call enqueues another run. A run may be rejected if one is already queued or in progress for the flow.
  - Requires Tableau REST API access scopes \`tableau:flows:run\`, \`tableau:flows:read\` (for bounded-context verification), and \`tableau:mcp_site_settings:read\`.`,
    paramsSchema,
    annotations: {
      title: 'Run Flow',
      readOnlyHint: false,
      // A run overwrites the flow's configured outputs, so clients should treat
      // it as destructive even though it does not alter the flow definition or
      // its schedule.
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
    callback: async (
      { flowId, runMode, outputStepIds, parameterOverrides },
      extra,
    ): Promise<CallToolResult> => {
      return await runFlowTool.logAndExecute<RunFlowResult>({
        extra,
        // Keep free-form flow parameter values out of debug logs and MCP
        // invocation notifications. The callback below still closes over and
        // sends the original values to Tableau.
        args: {
          flowId,
          runMode,
          outputStepIds,
          parameterOverrides: redactParameterOverrides(parameterOverrides),
        },
        callback: async () => {
          if (!RestApi.versionIsAtLeast(MIN_RUN_FLOW_SPEC_REST_VERSION)) {
            return new McpToolError({
              type: 'flow-run-version-unsupported',
              statusCode: 400,
              message: [
                `Run Flow requires Tableau REST API version ${MIN_RUN_FLOW_SPEC_REST_VERSION} or later in this MCP server.`,
                'Older Tableau Server versions use a legacy Run Flow request shape that this tool does not send, so refusing avoids silently ignoring run options or running unintended output steps.',
              ].join(' '),
            }).toErr();
          }

          // Bounded-context gate (mirrors get-flow): when the instance is
          // restricted via PROJECT_IDS / TAGS, refuse to run a flow outside the
          // allowed set BEFORE enqueuing anything. Running a flow we cannot
          // prove is in-scope is strictly worse than merely listing it.
          const isFlowAllowedResult = await resourceAccessChecker.isFlowAllowed({
            flowId,
            extra,
          });
          if (!isFlowAllowedResult.allowed) {
            return new FlowNotAllowedError(isFlowAllowedResult.message).toErr();
          }

          try {
            const job = await useRestApi({
              ...extra,
              jwtScopes: runFlowTool.requiredApiScopes,
              callback: async (restApi) =>
                restApi.flowsMethods.runFlowNow({
                  siteId: restApi.siteId,
                  flowId,
                  runMode,
                  outputStepIds,
                  parameterSpecs: parameterOverrides,
                }),
            });

            return new Ok({
              job,
              mcp: {
                runStatus:
                  'The flow run has been queued and is running asynchronously. Use list-flow-runs or get-flow to check its status.',
              },
            } satisfies RunFlowResult);
          } catch (error) {
            return mapFlowWriteError(error, 'run this flow').toErr();
          }
        },
        constrainSuccessResult: (result) => ({ type: 'success', result }),
      });
    },
  });

  return runFlowTool;
};

function redactParameterOverrides(
  parameterOverrides: Array<{ parameterId: string; overrideValue: string }> | undefined,
): Array<{ parameterId: string; overrideValue: string }> | undefined {
  return parameterOverrides?.map(({ parameterId }) => ({
    parameterId,
    overrideValue: '<redacted>',
  }));
}

export const exportedForTesting = {
  runFlowParamsSchema: paramsSchema,
};
