import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { FlowNotAllowedError } from '../../../../errors/mcpToolError.js';
import { useRestApi } from '../../../../restApiInstance.js';
import { RestApi } from '../../../../sdks/tableau/restApi.js';
import {
  Flow,
  FlowConnection,
  FlowOutputStep,
  FlowRun,
} from '../../../../sdks/tableau/types/flow.js';
import { WebMcpServer } from '../../../../server.web.js';
import { TableauApiScope } from '../../../../server/oauth/scopes.js';
import { getExceptionMessage } from '../../../../utils/getExceptionMessage.js';
import { getHttpStatus } from '../../../../utils/getHttpStatus.js';
import { resourceAccessChecker } from '../../resourceAccessChecker.js';
import { WebTool } from '../../tool.js';

const FLOW_RUN_LIMIT_MAX = 100;

const paramsSchema = {
  flowId: z.string().nonempty(),
  includeConnections: z.boolean().optional().default(true),
  includeFlowRuns: z.boolean().optional().default(true),
  flowRunLimit: z.number().int().min(1).max(FLOW_RUN_LIMIT_MAX).optional().default(10),
};

export type GetFlowWarning =
  | {
      type: 'SIDECAR_FETCH_FAILED';
      severity: 'WARNING';
      message: string;
      affectedField: 'connections' | 'flowRuns';
      httpStatus?: string;
    }
  | {
      type: 'VERSION_GATE_SKIPPED';
      severity: 'WARNING';
      message: string;
      affectedField: 'flowRuns';
    }
  | {
      // Surfaced when the Tableau Flow Runs endpoint returned at least one row
      // beyond `flowRunLimit`, meaning the response array was capped and there
      // is more historical data the LLM would otherwise be unaware of. Detected
      // via the "+1 probe" technique: we ask Tableau for `flowRunLimit + 1`
      // rows in a single call; if more than `flowRunLimit` come back, we slice
      // and emit this warning. The Tableau Flow Runs endpoint does not return
      // a `pagination` block (verified live on REST 3.30) so this is the only
      // way to definitively distinguish "complete history" from "truncated".
      type: 'FLOW_RUNS_TRUNCATED';
      severity: 'WARNING';
      message: string;
      affectedField: 'flowRuns';
      returnedCount: number;
    };

export type GetFlowResult = Flow & {
  outputSteps: FlowOutputStep[];
  connections?: FlowConnection[];
  flowRuns?: FlowRun[];
  mcp?: {
    warnings: GetFlowWarning[];
  };
};

export const getGetFlowTool = (server: WebMcpServer): WebTool<typeof paramsSchema> => {
  const getFlowTool = new WebTool({
    server,
    name: 'get-flow',
    description: `
  Retrieves detailed information about a specific Tableau Prep flow, including the flow's metadata (name, description, owner, project, tags, parameters), its output step IDs and names, and optionally its input connections and recent run history. This is the primary tool to use when a user asks about a specific flow's structure, contents, recent runs, or input data sources.

  **Returned Fields**
  - Flow metadata: id, name, description, webpageUrl, fileType, createdAt, updatedAt, project, owner, tags, parameters.
  - \`outputSteps\`: array of \`{id, name}\` for each output step in the flow.
  - \`connections\` (when \`includeConnections=true\`): array of input data connections (id, type, serverAddress, userName, embedPassword).
  - \`flowRuns\` (when \`includeFlowRuns=true\`, on Tableau versions that support the flow-runs endpoint): up to \`flowRunLimit\` most-recent flow runs (id, status, startedAt, completedAt, progress, backgroundJobId), newest first.
  - \`mcp.warnings\` (only when warnings are emitted): list of non-fatal issues. Warning types include:
    - \`SIDECAR_FETCH_FAILED\`: an optional sidecar fetch (connections or runs) failed; the rest of the response is still valid.
    - \`VERSION_GATE_SKIPPED\`: this Tableau version does not support the flow-runs endpoint.
    - \`FLOW_RUNS_TRUNCATED\`: the flow has more historical runs than \`flowRunLimit\`. The returned \`flowRuns\` array is the most-recent slice; older runs exist but are NOT included. **Always inspect \`mcp.warnings\` before reporting "complete history" to the user.**

  **Response-Size Guidance**
  By default this tool returns metadata + output steps + all connections + the 10 most-recent runs. Each sidecar adds payload, so prefer the narrowest call that answers the user's question:
  - **Just metadata / "what is this flow?"**: pass \`includeConnections: false\` and \`includeFlowRuns: false\`. This is the cheapest call and the right default when the user only asks about ownership, project, description, or output steps. The Tableau API scopes requested at sign-in are narrowed accordingly, so this path also succeeds against connected apps that only grant \`tableau:flows:read\`.
  - **"What does this flow read from?"**: keep \`includeConnections: true\`, set \`includeFlowRuns: false\`. Connections are usually a handful per flow, but complex flows can have 10+.
  - **"Did the latest run succeed?" / "What's the status?"**: keep \`includeFlowRuns: true\` but set \`flowRunLimit: 1\` (or 3) — the default of 10 is wasteful for a single-status check.
  - **"Show me the run history"**: keep \`includeFlowRuns: true\` and raise \`flowRunLimit\` only as far as the user actually needs (max 100 per call).
  - When in doubt, prefer the lower limit — you can always re-call with a higher limit if the first response is insufficient.

  **Run-history truncation (important)**
  A single call returns at most \`flowRunLimit\` runs (newest first). If the flow has more, the response carries a \`FLOW_RUNS_TRUNCATED\` warning — the ONLY signal that the window is partial, so never report a truncated window as the complete history. To see more: re-call with a higher \`flowRunLimit\` (max 100); for deeper history or a specific date range, use the Tableau Flow Runs REST API directly (\`filter=flowId:eq:<id>\` with \`pageNumber\` pagination, or a \`startedAt\` date filter).

  **Limitations**
  - Error details for \`Failed\` flow runs are not exposed in this version of the tool. The \`status\` field is available; the underlying job error message is not.
  - The \`flowRuns\` field reflects ad-hoc runs returned by the public REST API; per-output-step details are not included.
  - A single call returns at most 100 \`flowRuns\` (\`flowRunLimit\` max). Tableau's Flow Runs endpoint does not expose a total-count field, so the tool cannot tell you exactly how many runs exist beyond what was returned — only that more do (via the \`FLOW_RUNS_TRUNCATED\` warning).

  **Example Usage**
  - Get a flow's metadata and output steps only (cheapest call, no sidecars):
      flowId: "d00700fe-28a0-4ece-a7af-5543ddf38a82"
      includeConnections: false
      includeFlowRuns: false
  - Get a flow plus its data connections (no run history):
      flowId: "d00700fe-28a0-4ece-a7af-5543ddf38a82"
      includeFlowRuns: false
  - Get a flow and only the most recent run (status check):
      flowId: "d00700fe-28a0-4ece-a7af-5543ddf38a82"
      flowRunLimit: 1
  - Get a flow with the 5 most-recent runs:
      flowId: "d00700fe-28a0-4ece-a7af-5543ddf38a82"
      flowRunLimit: 5`,
    paramsSchema,
    annotations: {
      title: 'Get Flow',
      readOnlyHint: true,
      openWorldHint: false,
    },
    callback: async (
      { flowId, includeConnections, includeFlowRuns, flowRunLimit },
      extra,
    ): Promise<CallToolResult> => {
      // Compute the JWT scopes actually needed for THIS call. The tool's
      // static `requiredApiScopes` is the maximum-possible set
      // (flows + flow_connections + flow_runs + site_settings) and is the
      // right gate for the MCP-layer OAuth check ("is the caller allowed to
      // invoke get-flow at all?"). But the JWT mint inside useRestApi is a
      // narrower gate: Tableau Connected Apps reject a JWT that requests an
      // un-granted scope, so an operator who deployed a metadata-only
      // connected app (no flow_connections / flow_runs grants) would see
      // `get-flow` fail at sign-in even when the caller passed
      // includeConnections:false / includeFlowRuns:false. Compute the
      // smallest viable scope set per call so metadata-only deployments
      // succeed.
      const tableauApiScopes: TableauApiScope[] = [
        'tableau:flows:read',
        'tableau:mcp_site_settings:read',
      ];
      if (includeConnections) {
        tableauApiScopes.push('tableau:flow_connections:read');
      }
      if (includeFlowRuns) {
        tableauApiScopes.push('tableau:flow_runs:read');
      }

      return await getFlowTool.logAndExecute<GetFlowResult>({
        extra,
        args: { flowId, includeConnections, includeFlowRuns, flowRunLimit },
        callback: async () => {
          // Bounded-context gate (mirrors get-workbook). When the instance is
          // restricted via PROJECT_IDS / TAGS, reject flows outside the allowed
          // set BEFORE fetching any flow detail or sidecars — otherwise get-flow
          // could be used to read a flow by id that list-flows would have
          // filtered out. When no bounded context is configured, this resolves
          // to `{ allowed: true }` without an extra REST call.
          const isFlowAllowedResult = await resourceAccessChecker.isFlowAllowed({
            flowId,
            extra,
          });

          if (!isFlowAllowedResult.allowed) {
            return new FlowNotAllowedError(isFlowAllowedResult.message).toErr();
          }

          return new Ok(
            await useRestApi({
              ...extra,
              jwtScopes: tableauApiScopes,
              callback: async (restApi) => {
                const warnings: GetFlowWarning[] = [];

                // Primary call: Query Flow. When a project/tag bounded context
                // was active, the access check already fetched the flow — reuse
                // it instead of fetching twice. Failure here propagates as an error.
                const { flow, outputSteps } =
                  isFlowAllowedResult.content ??
                  (await restApi.flowsMethods.queryFlow({
                    siteId: restApi.siteId,
                    flowId,
                  }));

                let connections: FlowConnection[] | undefined;
                if (includeConnections) {
                  try {
                    connections = await restApi.flowsMethods.queryFlowConnections({
                      siteId: restApi.siteId,
                      flowId,
                    });
                  } catch (error) {
                    warnings.push({
                      type: 'SIDECAR_FETCH_FAILED',
                      severity: 'WARNING',
                      message: `Failed to fetch flow connections: ${getExceptionMessage(error)}`,
                      affectedField: 'connections',
                      httpStatus:
                        error instanceof Error ? getHttpStatus(error) || undefined : undefined,
                    });
                  }
                }

                let flowRuns: FlowRun[] | undefined;
                if (includeFlowRuns) {
                  if (RestApi.versionIsAtLeast('3.10')) {
                    try {
                      // "+1 probe" — request one row beyond `flowRunLimit` so we
                      // can definitively distinguish "exactly this many runs"
                      // from "truncated, more exist". Tableau's runs endpoint
                      // returns no `pagination` block, so this is the only way
                      // to detect truncation in a single REST round-trip.
                      const fetched = await restApi.flowsMethods.getFlowRuns({
                        siteId: restApi.siteId,
                        filter: `flowId:eq:${flowId}`,
                        sort: 'startedAt:desc',
                        pageSize: flowRunLimit + 1,
                      });
                      if (fetched.length > flowRunLimit) {
                        flowRuns = fetched.slice(0, flowRunLimit);
                        warnings.push({
                          type: 'FLOW_RUNS_TRUNCATED',
                          severity: 'WARNING',
                          message: [
                            `Returned the ${flowRunLimit} most-recent flow runs (sorted startedAt desc). The flow has additional historical runs not included in this response.`,
                            'To see more runs:',
                            `1. Re-call this tool with a higher \`flowRunLimit\` (max ${FLOW_RUN_LIMIT_MAX}).`,
                            `2. For deeper history (more than ${FLOW_RUN_LIMIT_MAX} runs) use the Tableau Flow Runs REST API directly with \`filter=flowId:eq:${flowId}\` and \`pageNumber\` pagination, or with a date-range filter (e.g. \`startedAt:gt:<iso-timestamp>\`).`,
                          ].join(' '),
                          affectedField: 'flowRuns',
                          returnedCount: flowRunLimit,
                        });
                      } else {
                        flowRuns = fetched;
                      }
                    } catch (error) {
                      warnings.push({
                        type: 'SIDECAR_FETCH_FAILED',
                        severity: 'WARNING',
                        message: `Failed to fetch flow runs: ${getExceptionMessage(error)}`,
                        affectedField: 'flowRuns',
                        httpStatus:
                          error instanceof Error ? getHttpStatus(error) || undefined : undefined,
                      });
                    }
                  } else {
                    warnings.push({
                      type: 'VERSION_GATE_SKIPPED',
                      severity: 'WARNING',
                      message:
                        'Flow runs require Tableau REST API version 3.10 or later (Tableau Server 2020.4+). The current server version does not support this endpoint.',
                      affectedField: 'flowRuns',
                    });
                  }
                }

                const result: GetFlowResult = {
                  ...flow,
                  outputSteps,
                  ...(connections !== undefined && { connections }),
                  ...(flowRuns !== undefined && { flowRuns }),
                  ...(warnings.length > 0 && { mcp: { warnings } }),
                };

                return result;
              },
            }),
          );
        },
        constrainSuccessResult: (result) => ({
          type: 'success',
          result,
        }),
      });
    },
  });

  return getFlowTool;
};

export const exportedForTesting = {
  getFlowParamsSchema: paramsSchema,
};
