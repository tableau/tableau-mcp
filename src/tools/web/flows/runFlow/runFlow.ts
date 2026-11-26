import { createHash } from 'node:crypto';

import { CallToolResult } from '@modelcontextprotocol/server';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { getConfig } from '../../../../config.js';
import { FlowNotAllowedError, McpToolError } from '../../../../errors/mcpToolError.js';
import { isFlowWriteToolsEnabled } from '../../../../features/flowTools.js';
import { useRestApi } from '../../../../restApiInstance.js';
import { luidSchema } from '../../../../sdks/routeSafety/ids.js';
import { RestApi } from '../../../../sdks/tableau/restApi.js';
import { RunFlowJob } from '../../../../sdks/tableau/types/job.js';
import { SiteRole } from '../../../../sdks/tableau/types/user.js';
import { WebMcpServer } from '../../../../server.web.js';
import { Provider } from '../../../../utils/provider.js';
import { SignedConfirmation } from '../../_lib/signedConfirmation.js';
import { resourceAccessChecker } from '../../resourceAccessChecker.js';
import { WebTool } from '../../tool.js';
import { resolveFlowRunPreState } from '../flowRunPreState.js';
import { mapFlowWriteError } from '../flowWriteErrors.js';

const MIN_RUN_FLOW_SPEC_REST_VERSION = '3.14';

const paramsSchema = {
  flowId: luidSchema,
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
  confirm: z.boolean().optional(),
  confirmationToken: z.string().optional(),
};

export type RunFlowResult =
  | {
      job: RunFlowJob;
      mcp: {
        runStatus: string;
      };
    }
  | string;

export const getRunFlowTool = (server: WebMcpServer): WebTool<typeof paramsSchema> => {
  const config = getConfig();
  const runFlowTool = new WebTool({
    server,
    name: 'run-flow',
    minRequiredRole: SiteRole.EXPLORER_CAN_PUBLISH,
    disabled: new Provider(async () => !(await isFlowWriteToolsEnabled(config))),
    description: `
  Runs a Tableau Prep flow **on demand** ("Run Now") through a required two-phase confirmation. The preview describes the run without enqueuing it; the confirmed call enqueues the flow and returns immediately with an async job. The flow executes its output steps (all of them unless you pass \`outputStepIds\`), writing to its configured outputs.

  Use this tool when the user explicitly wants to **run / refresh / execute** a specific flow right now (by flow id). To run an *existing schedule* now instead, use \`run-flow-task\`. To only inspect a flow or its runs, use \`get-flow\` / \`list-flow-runs\` (read-only).

  **This tool changes server state.** A confirmed run consumes warehouse + Tableau Prep Conductor capacity and overwrites the flow's outputs. Do not confirm until the user has explicitly approved the preview.

  **Two-phase confirmation:**
  1. **Preview** (\`confirm\` omitted or false): checks the requested run and bounded-context eligibility, starts no run, and returns a short-lived confirmation token bound to this change.
  2. **Run** (\`confirm: true\`): requires the token from the matching preview. The server verifies it before enqueuing the flow, and rejects it if the run options changed or a new run of this flow appeared since the preview.

  **Parameters:**
  - \`flowId\` (required) – The flow to run.
  - \`runMode\` (optional) – \`full\` (default) or \`incremental\`. Incremental only works if the flow's input steps are configured for incremental refresh.
  - \`outputStepIds\` (optional) – Run only these output steps (ids from \`get-flow\`). If provided, it must contain at least one id; omit it to run every output step.
  - \`parameterOverrides\` (optional) – Array of \`{ parameterId, overrideValue }\` for flows that use parameters. Required parameters must be supplied. Use \`get-flow\` to discover parameter ids and whether they are required.
  - \`confirm\` (optional) – Set \`true\` only after the user approves the preview.
  - \`confirmationToken\` (optional) – The token returned by the matching preview. Required when \`confirm\` is true.

  **Response:** Preview returns instructions and a confirmation token. A confirmed call returns \`{ job, mcp: { runStatus } }\`. \`job\` includes \`id\` (background job id) and \`runFlowJobType.flowRunId\` (the flow run id). The run is asynchronous: report it as *started/queued*, and to check the outcome poll with \`list-flow-runs\` (filter \`flowId:eq:<id>\`) or \`get-flow\` (\`flowRunLimit: 1\`).

  **Requirements & limits:**
  - Requires Tableau REST API version **3.14 or later**. Older Tableau Server versions use a legacy Run Flow request shape that this MCP tool does not send, so the tool refuses instead of risking silently ignored run options or unintended output steps.
  - Requires **Data Management with Tableau Prep Conductor**, and the site's **Run Now** setting must be enabled.
  - **Caller-role:** in addition to admins/project leaders, the flow owner and users granted Run Flow / Execute permission can run a flow. Non-permitted callers get a clear permission error.
  - Not idempotent — each call enqueues another run. A run may be rejected if one is already queued or in progress for the flow.
  - Requires Tableau REST API access scopes \`tableau:flows:run\`, \`tableau:flows:read\` (for bounded-context verification), \`tableau:flow_runs:read\` (to bind the token to the flow's latest runs), and \`tableau:mcp_site_settings:read\`.`,
    paramsSchema,
    annotations: {
      title: 'Run Flow',
      readOnlyHint: false,
      // A run can overwrite configured outputs.
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
    callback: async (
      { flowId, runMode, outputStepIds, parameterOverrides, confirm, confirmationToken },
      extra,
    ): Promise<CallToolResult> => {
      return await runFlowTool.logAndExecute<RunFlowResult>({
        extra,
        // Redact free-form parameter values from logs; send the originals to Tableau.
        args: {
          flowId,
          runMode,
          outputStepIds,
          parameterOverrides: redactParameterOverrides(parameterOverrides),
          ...(confirm === undefined ? {} : { confirm }),
          ...(confirmationToken ? { confirmationToken: '<redacted>' } : {}),
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

          // Verify the target before mutating under a bounded context.
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
              callback: async (restApi) => {
                // Server-signed, short-lived token bound to site, user, tool, flow, the run
                // parameters (binding) AND the flow's newest runs (pre-state), so it verifies on any
                // replica sharing MUTATION_TOKEN_SECRET and is rejected once another run appears.
                const confirmation = new SignedConfirmation({
                  tool: 'run-flow',
                  targetId: flowId,
                  targetKind: 'flow',
                  binding: createRunFlowBinding({
                    flowId,
                    runMode,
                    outputStepIds,
                    parameterOverrides,
                  }),
                  resolveState: () => resolveFlowRunPreState(restApi, flowId),
                  text: {
                    subject: 'present this proposed flow run',
                    approvalClause: 'confirm it. Do NOT run',
                    tail: ' before starting the flow run).',
                  },
                });
                const caller = { restApi, userLuid: extra.getUserLuid() };

                if (!confirm) {
                  const outputDescription = outputStepIds?.length
                    ? `output steps ${outputStepIds.join(', ')}`
                    : 'all output steps';
                  const overrideDescription = parameterOverrides?.length
                    ? ` with ${parameterOverrides.length} parameter override${parameterOverrides.length === 1 ? '' : 's'}`
                    : '';
                  return (
                    `Preview — would enqueue a ${runMode ?? 'full'} run for flow '${flowId}' using ${outputDescription}${overrideDescription}. ` +
                    'No flow run has been started. ' +
                    (await confirmation.preview(caller))
                  );
                }

                return await confirmation.confirmAndRun(caller, confirmationToken, () =>
                  restApi.flowsMethods.runFlowNow({
                    siteId: restApi.siteId,
                    flowId,
                    runMode,
                    outputStepIds,
                    parameterSpecs: parameterOverrides,
                  }),
                );
              },
            });

            if (typeof job === 'string') {
              return new Ok(job);
            }
            return new Ok({
              job,
              mcp: {
                runStatus:
                  'The flow run has been queued and is running asynchronously. Use list-flow-runs or get-flow to check its status.',
              },
            } satisfies RunFlowResult);
          } catch (error) {
            return mapFlowWriteError(
              error,
              confirm ? 'run this flow' : 'preview this flow run',
            ).toErr();
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

/** SHA-256 fingerprint binding the preview token to the request without exposing raw parameter values. */
function createRunFlowBinding({
  flowId,
  runMode,
  outputStepIds,
  parameterOverrides,
}: {
  flowId: string;
  runMode?: 'full' | 'incremental';
  outputStepIds?: string[];
  parameterOverrides?: Array<{ parameterId: string; overrideValue: string }>;
}): string {
  const sortedOutputSteps = outputStepIds ? [...outputStepIds].sort() : [];
  const sortedOverrides = parameterOverrides
    ? [...parameterOverrides]
        .map((o) => ({ parameterId: o.parameterId, overrideValue: o.overrideValue }))
        .sort((a, b) => a.parameterId.localeCompare(b.parameterId))
    : [];

  return createHash('sha256')
    .update(
      JSON.stringify({
        flowId,
        runMode: runMode ?? 'full',
        outputStepIds: sortedOutputSteps,
        parameterOverrides: sortedOverrides,
      }),
    )
    .digest('hex');
}

export const exportedForTesting = {
  runFlowParamsSchema: paramsSchema,
  createRunFlowBinding,
};
