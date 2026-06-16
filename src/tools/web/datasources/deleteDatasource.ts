import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { createHash } from 'crypto';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { getConfig } from '../../../config.js';
import {
  AdminOnlyError,
  ArgsValidationError,
  DatasourceNotAllowedError,
} from '../../../errors/mcpToolError.js';
import { log } from '../../../logging/logger.js';
import { useRestApi } from '../../../restApiInstance.js';
import {
  DatasourceDownstream,
  getDatasourceDownstreamByLuid,
  getDatasourceDownstreamQuery,
} from '../../../sdks/tableau/methods/lineageUtils.js';
import { RestApi } from '../../../sdks/tableau/restApi.js';
import { WebMcpServer } from '../../../server.web.js';
import { getExceptionMessage } from '../../../utils/getExceptionMessage.js';
import { assertAdmin } from '../adminGate.js';
import { resourceAccessChecker } from '../resourceAccessChecker.js';
import { WebTool } from '../tool.js';

const RECYCLE_BIN_DOC_URL = 'https://help.tableau.com/current/pro/desktop/en-us/recycle_bin.htm';

// Default tag applied during the preview phase to mark a datasource as pending deletion. Reversible
// and visible in the Tableau UI, giving owners a window to object before the confirmed delete.
// Generic by design — callers (e.g. the Stale Content Cleanup prompt) override via `tag`.
// NOTE: intentionally duplicated from deleteWorkbook.ts to keep this (in-flight, dependent) PR
// purely additive; extract to a shared _lib module once both delete tools have merged.
export const DEFAULT_PENDING_DELETION_TAG = 'pending-deletion';

/**
 * Deterministic confirmation token derived from the site + datasource. The preview phase returns
 * it; the delete phase requires it. Because the value is only obtainable by running the preview,
 * this forces a genuine two-step (preview → confirm) flow and prevents a blind single-call delete.
 * Stateless by design (no server-side nonce store) so it works across instances and restarts.
 */
export function computeConfirmationToken(siteId: string, datasourceId: string): string {
  return createHash('sha256').update(`${siteId}:${datasourceId}`).digest('hex').slice(0, 12);
}

const paramsSchema = {
  datasourceId: z.string().describe('The LUID of the published data source to delete.'),
  confirm: z
    .boolean()
    .optional()
    .describe(
      'When omitted or false, runs a non-destructive preview: tags the data source as pending ' +
        'deletion, warns about dependent workbooks/flows, and reports what would be deleted. When ' +
        'true, permanently deletes the data source (recoverable from the Tableau recycle bin for a ' +
        'limited time).',
    ),
  confirmationToken: z
    .string()
    .optional()
    .describe(
      'Required when confirm is true. The confirmationToken returned by the preview step ' +
        '(confirm omitted/false) for this data source. Deletion is rejected without a matching ' +
        'token, which guarantees a preview was run first.',
    ),
  tag: z
    .string()
    .optional()
    .describe(
      'Label applied to the data source during the preview phase to mark it as pending deletion ' +
        `(reversible, visible in the Tableau UI). Defaults to '${DEFAULT_PENDING_DELETION_TAG}'.`,
    ),
};

export const getDeleteDatasourceTool = (server: WebMcpServer): WebTool<typeof paramsSchema> => {
  const config = getConfig();

  const deleteDatasourceTool = new WebTool({
    server,
    name: 'delete-datasource',
    disabled: !config.adminToolsEnabled,
    description: `
Permanently deletes a published data source from the current Tableau Cloud site. Restricted to
Tableau site administrators and requires the \`ADMIN_TOOLS_ENABLED\` feature flag.

This tool is **two-phase** to keep the destructive action safe:

1. **Preview (default — \`confirm\` omitted or false):** tags the data source as pending deletion
   (reversible, visible in the Tableau UI; label configurable via \`tag\`, default
   \`${DEFAULT_PENDING_DELETION_TAG}\`), reports the data source name, project, and owner, **warns
   which workbooks and flows depend on it and may break**, returns a \`confirmationToken\`, and does
   **not** delete anything.
2. **Delete (\`confirm: true\` + \`confirmationToken\`):** permanently removes the data source. The
   token from step 1 is required — deletion is rejected without it, which guarantees the preview
   was run first. On Tableau Cloud the data source is moved to the recycle bin and can be restored
   for a limited time before permanent removal (see ${RECYCLE_BIN_DOC_URL}). Dependent workbooks and
   flows are **not** deleted, but will lose this data source.

**Required human confirmation:** After preview, present the data source (name, project, owner) and
its dependent content to the user and get explicit approval before deleting. Do not auto-confirm or
compute the \`confirmationToken\` yourself — use the exact value the preview returned.

**Parameters:**
- \`datasourceId\` (required) – The LUID of the data source. Obtain it from \`list-datasources\`.
- \`confirm\` (optional) – Set \`true\` to perform the deletion. Defaults to preview.
- \`confirmationToken\` (optional) – Required when \`confirm\` is true; the token from the preview step.
- \`tag\` (optional) – Preview tag label. Defaults to \`${DEFAULT_PENDING_DELETION_TAG}\`.
`.trim(),
    paramsSchema,
    annotations: {
      title: 'Delete Datasource',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    callback: async (
      { datasourceId, confirm, confirmationToken, tag },
      extra,
    ): Promise<CallToolResult> => {
      const configWithOverrides = await extra.getConfigWithOverrides();

      return await deleteDatasourceTool.logAndExecute<string>({
        extra,
        args: { datasourceId, confirm, confirmationToken, tag },
        callback: async () => {
          return await useRestApi({
            ...extra,
            jwtScopes: deleteDatasourceTool.requiredApiScopes,
            callback: async (restApi) => {
              const adminResult = await assertAdmin(restApi, extra);
              if (adminResult.isErr()) {
                return new AdminOnlyError(adminResult.error).toErr();
              }

              const siteId = restApi.siteId;
              const expectedToken = computeConfirmationToken(siteId, datasourceId);

              // Gate the destructive path on the preview-issued token BEFORE any read or write.
              // The token is only obtainable by running the preview, so a missing/mismatched
              // token means no preview was run for this datasource — reject without side effects.
              if (confirm && confirmationToken !== expectedToken) {
                return new ArgsValidationError(
                  'Deletion requires the confirmationToken returned by the preview step. ' +
                    'Run delete-datasource with confirm omitted (or false) for this datasourceId ' +
                    'first, then call again with confirm: true and the confirmationToken from that ' +
                    'response.',
                ).toErr();
              }

              // Honor the same tool-scoping rules the read tools enforce (e.g. get-datasource-metadata):
              // a data source outside the configured bounded context cannot be tagged or deleted.
              // Runs before any read/write so a rejected call has zero side effects.
              const isDatasourceAllowedResult = await resourceAccessChecker.isDatasourceAllowed({
                datasourceLuid: datasourceId,
                extra,
              });
              if (!isDatasourceAllowedResult.allowed) {
                return new DatasourceNotAllowedError(isDatasourceAllowedResult.message).toErr();
              }

              // Resolve identity in both phases so the response (preview AND the final delete
              // confirmation) always names the data source, project, and owner for an auditable
              // record of exactly what was acted on.
              const datasource = await restApi.datasourcesMethods.queryDatasource({
                datasourceId,
                siteId,
              });
              const ownerEmail = await resolveOwnerEmail(restApi, siteId, datasource.owner?.id);
              const projectName = datasource.project?.name ?? 'unknown project';
              const ownerText = ownerEmail ? `owner ${ownerEmail}` : 'owner unknown';

              if (confirm) {
                await restApi.datasourcesMethods.deleteDatasource({ datasourceId, siteId });
                return new Ok(
                  `Deleted data source '${datasource.name}' (id ${datasourceId}) in '${projectName}', ${ownerText}. ` +
                    `It can be restored from the Tableau recycle bin (${RECYCLE_BIN_DOC_URL}) for a ` +
                    'limited time before permanent removal. Dependent workbooks and flows were not ' +
                    'deleted but no longer have this data source.',
                );
              }

              // Preview phase: warn about dependents, tag as pending deletion, report. No deletion.
              const dependencyWarning = await describeDownstreamDependencies({
                restApi,
                datasourceId,
                disableMetadataApiRequests: configWithOverrides.disableMetadataApiRequests,
              });

              // Treat undefined, empty, and whitespace-only tags as "use the default" so a
              // blank label never gets applied to the data source.
              const pendingTag = tag?.trim() ? tag : DEFAULT_PENDING_DELETION_TAG;
              await restApi.datasourcesMethods.addTagsToDatasource({
                datasourceId,
                siteId,
                tagLabels: [pendingTag],
              });

              return new Ok(
                `Preview — data source '${datasource.name}' (id ${datasourceId}) in '${projectName}', ${ownerText}. ` +
                  `${dependencyWarning} ` +
                  `It has been tagged '${pendingTag}' (reversible). ` +
                  'NEXT STEP — REQUIRED: show this data source (name, project, owner) and its dependent ' +
                  'content to the user and ask them to explicitly confirm deleting it. Do NOT delete ' +
                  'without the user’s approval. ' +
                  `Once approved, call again with confirm: true and confirmationToken: ${expectedToken}. ` +
                  `Deleted data sources are recoverable from the Tableau recycle bin (${RECYCLE_BIN_DOC_URL}) ` +
                  'for a limited time.',
              );
            },
          });
        },
        constrainSuccessResult: (result) => ({ type: 'success', result }),
      });
    },
  });

  return deleteDatasourceTool;
};

/**
 * Builds a human-readable warning about the workbooks and flows that depend on this datasource,
 * via the Metadata API reverse-lineage query. Best-effort: if the Metadata API is disabled or
 * errors, we degrade to a neutral note and never fail the preview.
 */
async function describeDownstreamDependencies({
  restApi,
  datasourceId,
  disableMetadataApiRequests,
}: {
  restApi: RestApi;
  datasourceId: string;
  disableMetadataApiRequests: boolean;
}): Promise<string> {
  if (disableMetadataApiRequests) {
    return 'Dependency check skipped (Metadata API requests are disabled).';
  }

  let downstream: DatasourceDownstream | undefined;
  try {
    const response = await restApi.metadataMethods.graphql(
      getDatasourceDownstreamQuery([datasourceId]),
    );
    downstream = getDatasourceDownstreamByLuid(response).get(datasourceId);
  } catch (error) {
    log({
      message: `delete-datasource: downstream dependency check failed for ${datasourceId}`,
      level: 'warning',
      logger: 'delete-datasource',
      data: getExceptionMessage(error),
    });
    return 'Dependency check unavailable (Metadata API error) — verify dependents manually before deleting.';
  }

  const workbooks = downstream?.workbooks ?? [];
  const flows = downstream?.flows ?? [];
  if (workbooks.length === 0 && flows.length === 0) {
    return 'No workbooks or flows were found that depend on this data source.';
  }

  const parts: string[] = [];
  if (workbooks.length > 0) {
    parts.push(`${workbooks.length} workbook(s): ${workbooks.map((w) => w.name).join(', ')}`);
  }
  if (flows.length > 0) {
    parts.push(`${flows.length} flow(s): ${flows.map((f) => f.name).join(', ')}`);
  }
  return `⚠️ WARNING: deleting this data source may break ${parts.join(' and ')}.`;
}

/**
 * Best-effort resolution of the data source owner's email for the preview report. Owner lookup is
 * informational only, so a failure must not block the preview — we log and fall back to no email.
 */
async function resolveOwnerEmail(
  restApi: RestApi,
  siteId: string,
  ownerId: string | undefined,
): Promise<string | null> {
  if (!ownerId) {
    return null;
  }
  try {
    const owner = await restApi.usersMethods.queryUserOnSite({ siteId, userId: ownerId });
    return owner.email ?? owner.name ?? null;
  } catch (error) {
    log({
      message: `delete-datasource: failed to resolve owner ${ownerId} for preview`,
      level: 'warning',
      logger: 'delete-datasource',
      data: getExceptionMessage(error),
    });
    return null;
  }
}
