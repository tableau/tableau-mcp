import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { getConfig } from '../../../../config.js';
import {
  FlowDocumentApiDisabledError,
  FlowDocumentForbiddenError,
  FlowDocumentNotFoundError,
  FlowNotAllowedError,
} from '../../../../errors/mcpToolError.js';
import { useRestApi } from '../../../../restApiInstance.js';
import { Flow } from '../../../../sdks/tableau/types/flow.js';
import { WebMcpServer } from '../../../../server.web.js';
import { DESCRIBE_FLOW_API_SCOPES } from '../../../../server/oauth/scopes.js';
import { isAxiosError } from '../../../../utils/axios.js';
import { getExceptionMessage } from '../../../../utils/getExceptionMessage.js';
import { getHttpStatus } from '../../../../utils/getHttpStatus.js';
import { resourceAccessChecker } from '../../resourceAccessChecker.js';
import { WebTool } from '../../tool.js';
import {
  DescribeFlowResult,
  DescribeFlowWarning,
  summarizeFlowDocument,
} from './flowDocumentSummary.js';

const paramsSchema = {
  flowId: z.string().nonempty(),
  // Per-step column schemas are verbose and rarely needed to understand "what
  // does this flow do?", so they are opt-in.
  includeFieldSchemas: z.boolean().optional().default(false),
};

// Tableau error code returned by the flow-document endpoint when the
// experimental `GetFlowDocumentRestApi` feature flag is OFF. Verified live.
const FLOW_DOCUMENT_API_DISABLED_CODE = '403200';

/**
 * Reads the Tableau REST error code (e.g. "403200") from an Axios error. Tableau
 * serializes REST errors as `{ error: { code, summary, detail } }` in the body
 * and also echoes the code in the `tableau_error_code` response header, so we
 * check both. Used to distinguish the feature-flag-off 403 (code 403200) from an
 * ordinary forbidden / insufficient-permission 403.
 */
function getTableauErrorCode(error: unknown): string | undefined {
  if (!isAxiosError(error)) {
    return undefined;
  }
  const bodyCode = error.response?.data?.error?.code;
  if (typeof bodyCode === 'string' && bodyCode.length > 0) {
    return bodyCode;
  }
  const headerCode = error.response?.headers?.tableau_error_code;
  if (typeof headerCode === 'string' && headerCode.length > 0) {
    return headerCode;
  }
  return undefined;
}

export const getDescribeFlowTool = (server: WebMcpServer): WebTool<typeof paramsSchema> => {
  const config = getConfig();

  const describeFlowTool = new WebTool({
    server,
    name: 'describe-flow',
    disabled: !config.flowToolsEnabled,
    description: `
  Explains what a Tableau Prep flow actually *does* by reading and summarizing the flow's underlying document (the design of the flow itself, not just its catalog metadata). Use this when a user asks "what does this flow do?", "where does this flow get its data?", "what does it output?", "walk me through this flow", or wants to understand a flow's logic, sources, destinations, or shape without opening Tableau Prep.

  **describe-flow vs get-flow**
  - \`get-flow\` returns catalog *metadata* (name, owner, project, tags, output step names, input connections, recent run history). Use it for "who owns this?", "did the last run succeed?".
  - \`describe-flow\` returns the flow's *internal design*: its inputs and their data connections, its output destinations, the transformation steps in between, and the step-to-step lineage. Use it to understand the flow's purpose and data movement.

  **Returned fields (structured summary, not the raw document)**
  - \`flow\`: identity — id, name, description, project, owner, fileType, updatedAt, webpageUrl, tags.
  - \`stats\`: counts — nodeCount, inputCount, outputCount, transformCount, connectionCount. A cheap at-a-glance size/shape signal.
  - \`inputs\`: each input step with a human-readable \`role\` (e.g. "Input — CSV file") and, where available, its resolved \`connection\` (type, server, database, schema, file, isPackaged).
  - \`outputs\`: each output/write step with a \`role\` (e.g. "Output — published data source / extract") and any recognizable \`target\` details.
  - \`steps\`: the transformation steps (joins, aggregates, filters, calculations, pivots, …) each with a friendly \`role\`.
  - \`lineage\`: directed \`{from, to}\` edges (by step name) describing how data flows step-to-step.
  - \`connections\`: the de-duplicated list of all data connections referenced by the flow.
  - \`parameters\`: the flow's parameters (name, type, value).
  - \`fields\` (only when \`includeFieldSchemas=true\`): per-step column lists ({name, type}). Verbose — request only when the user asks about specific columns/schema.

  **Data safety**
  The document is fetched through a server-side sanitized endpoint: credentials, secrets, and email-shaped PII are redacted before the document leaves Tableau. This tool surfaces only structural/topology fields and never returns passwords or tokens.

  **Availability & errors**
  - This relies on an experimental Tableau REST API (\`/api/exp/.../flows/{id}/document\`). If the server has not enabled it, the call fails with a clear "experimental flow-document API is not enabled" message — fall back to \`get-flow\` for metadata.
  - If the flow id is unknown, not visible to the caller, or has no stored document (e.g. a metadata-only seeded flow), the call fails with a "no flow document available" message — use \`list-flows\` to find a valid flow id.

  **Example usage**
  - Describe a flow's purpose and data movement:
      flowId: "d00700fe-28a0-4ece-a7af-5543ddf38a82"
  - Also include each step's column schema (verbose):
      flowId: "d00700fe-28a0-4ece-a7af-5543ddf38a82"
      includeFieldSchemas: true`,
    paramsSchema,
    annotations: {
      title: 'Describe Flow',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    callback: async ({ flowId, includeFieldSchemas }, extra): Promise<CallToolResult> => {
      return await describeFlowTool.logAndExecute<DescribeFlowResult>({
        extra,
        args: { flowId, includeFieldSchemas },
        callback: async () => {
          // Bounded-context gate (mirrors get-flow). When the instance is
          // restricted via PROJECT_IDS / TAGS, reject flows outside the allowed
          // set BEFORE downloading any document. When no bounded context is
          // configured, this resolves to `{ allowed: true }` without a REST call.
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
              jwtScopes: DESCRIBE_FLOW_API_SCOPES,
              callback: async (restApi) => {
                const warnings: DescribeFlowWarning[] = [];

                // Primary call: download the sanitized flow document. Map the
                // expected failure modes to actionable errors; anything else
                // propagates to the generic handler.
                let document;
                try {
                  document = await restApi.flowDocumentMethods.getFlowDocument({
                    siteId: restApi.siteId,
                    flowId,
                  });
                } catch (error) {
                  const status = error instanceof Error ? getHttpStatus(error) : '';
                  if (status === '403') {
                    // A 403 has two very different meanings here. Only Tableau
                    // error code 403200 means the experimental API is disabled.
                    // Any other 403 is an authorization failure (no download
                    // permission, insufficient token scope, generic forbidden)
                    // and must NOT be reported as a feature-flag problem.
                    if (getTableauErrorCode(error) === FLOW_DOCUMENT_API_DISABLED_CODE) {
                      throw new FlowDocumentApiDisabledError(
                        `The experimental flow-document API is not enabled on this Tableau server, so the flow's design cannot be read. Ask a server administrator to enable it, or use get-flow for this flow's metadata instead. (flowId: ${flowId})`,
                      );
                    }
                    throw new FlowDocumentForbiddenError(
                      `Not authorized to download the document for flow ${flowId}. Reading a flow's design requires permission to download the flow (the same permission as downloading its .tfl/.tflx file in Tableau) and a token with the tableau:flows:download scope. Confirm you can download this flow in Tableau, then retry; otherwise use get-flow for metadata that does not require download permission.`,
                    );
                  }
                  if (status === '404') {
                    throw new FlowDocumentNotFoundError(
                      `No flow document is available for flow ${flowId}. The flow may not exist, may not be visible to you, or has no stored document (for example a metadata-only seeded flow). Use list-flows to find a valid flow id.`,
                    );
                  }
                  throw error;
                }

                // Identity enrichment. Reuse the flow already fetched by the
                // bounded-context check when present; otherwise fetch it. This is
                // best-effort: the document is the primary artifact, so if the
                // metadata call fails we still return the structural summary.
                let flow: Flow | undefined = isFlowAllowedResult.content?.flow;
                if (!flow) {
                  try {
                    flow = (
                      await restApi.flowsMethods.queryFlow({
                        siteId: restApi.siteId,
                        flowId,
                      })
                    ).flow;
                  } catch (error) {
                    warnings.push({
                      type: 'METADATA_FETCH_FAILED',
                      severity: 'WARNING',
                      message: `Could not load flow metadata (name/owner/project): ${getExceptionMessage(error)}. The structural summary below is derived from the flow document only.`,
                      affectedField: 'flow',
                      httpStatus:
                        error instanceof Error ? getHttpStatus(error) || undefined : undefined,
                    });
                  }
                }

                const result = summarizeFlowDocument({ document, flow, includeFieldSchemas });

                if (warnings.length > 0) {
                  result.mcp = { warnings: [...(result.mcp?.warnings ?? []), ...warnings] };
                }

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

  return describeFlowTool;
};

export const exportedForTesting = {
  describeFlowParamsSchema: paramsSchema,
};
