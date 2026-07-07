import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { getConfig } from '../../../config.js';
import { DatasourceNotAllowedError } from '../../../errors/mcpToolError.js';
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
import { DEFAULT_PENDING_DELETION_TAG, TagEvidence } from '../_lib/evidence.js';
import { guardMutation, MutationTarget } from '../_lib/mutationGuard.js';
import { resourceAccessChecker } from '../resourceAccessChecker.js';
import { WebTool } from '../tool.js';
import { resolveOwnerEmail } from '../users/resolveOwnerEmail.js';

const RECYCLE_BIN_DOC_URL = 'https://help.tableau.com/current/pro/desktop/en-us/recycle_bin.htm';

// Re-exported for back-compat with callers that imported it from this module before it moved to
// the shared evidence module.
export { DEFAULT_PENDING_DELETION_TAG };

const paramsSchema = {
  datasourceId: z.string().describe('The LUID of the published data source to delete.'),
  confirm: z
    .boolean()
    .optional()
    .describe(
      'When omitted or false, runs a non-destructive preview: tags the data source as pending ' +
        'deletion, warns about dependent workbooks/flows, and reports what would be deleted. When ' +
        'true, deletes the data source — but only if it is currently tagged as pending deletion by ' +
        'a prior preview call (the server re-fetches and verifies the tag). On Tableau Cloud it can ' +
        'be restored from the recycle bin for a limited time; on Tableau Server deletion is permanent.',
    ),
  tag: z
    .string()
    .max(200)
    // Constrain to a safe tag character class. `tag` is interpolated into the preview-response text
    // the model reads back, so restricting it to alphanumerics/space/underscore/dash closes a
    // prompt-injection vector (e.g. a value with quotes/backticks trying to coerce auto-confirming).
    .regex(
      /^[A-Za-z0-9 _-]+$/,
      'tag must contain only letters, numbers, spaces, underscores, and dashes',
    )
    .optional()
    .describe(
      'Label applied to the data source during the preview phase to mark it as pending deletion ' +
        '(reversible, visible in the Tableau UI). Letters, numbers, spaces, underscores, and dashes ' +
        `only. Defaults to '${DEFAULT_PENDING_DELETION_TAG}'.`,
    ),
};

export const getDeleteDatasourceTool = (server: WebMcpServer): WebTool<typeof paramsSchema> => {
  const config = getConfig();

  const deleteDatasourceTool = new WebTool({
    server,
    name: 'delete-datasource',
    disabled: !config.adminToolsEnabled,
    description: `
Permanently deletes a published data source from the current Tableau site. Restricted to
Tableau site administrators and requires the \`ADMIN_TOOLS_ENABLED\` feature flag.

This tool is **two-phase** to keep the destructive action safe:

1. **Preview (default — \`confirm\` omitted or false):** tags the data source as pending deletion
   (reversible, visible in the Tableau UI; label configurable via \`tag\`, default
   \`${DEFAULT_PENDING_DELETION_TAG}\`), reports the data source name, project, and owner, **warns
   which workbooks and flows depend on it and may break**, and does **not** delete anything.
2. **Delete (\`confirm: true\`):** permanently removes the data source. Before deleting, the server
   re-fetches the data source and verifies it is tagged as pending deletion (the tag applied in
   step 1). If the tag is absent the deletion is rejected — this is a server-authoritative gate that
   genuinely requires the preview phase to have run; it cannot be bypassed by computing a token,
   because the caller has no way to set the tag other than by previewing. On Tableau Cloud the data
   source is moved to the recycle bin and can be restored for a limited time before permanent removal
   (see ${RECYCLE_BIN_DOC_URL}); on Tableau Server there is no recycle bin and deletion is permanent.
   Dependent workbooks and flows are **not** deleted, but will lose this data source.

**Required human confirmation:** After preview, present the data source (name, project, owner) and
its dependent content to the user and get explicit approval before calling again with \`confirm: true\`.
Do not auto-confirm — get the user's explicit approval first.

**Parameters:**
- \`datasourceId\` (required) – The LUID of the data source. Obtain it from \`list-datasources\`.
- \`confirm\` (optional) – Set \`true\` to perform the deletion (requires the pending-deletion tag from
  a prior preview). Defaults to preview.
- \`tag\` (optional) – Preview tag label. Defaults to \`${DEFAULT_PENDING_DELETION_TAG}\`. If you
  previewed with a custom tag, pass the same value when confirming.
`.trim(),
    paramsSchema,
    annotations: {
      title: 'Delete Datasource',
      readOnlyHint: false,
      destructiveHint: true,
      // Hard delete-by-id: a second delete of the same datasourceId 404s (isError: true), so the
      // operation is not idempotent. A client trusting an idempotent hint and retrying after a
      // transient failure would get a spurious error for a delete that already succeeded.
      // Matches the accepted resolution for delete-extract-refresh-task (tableau/tableau-mcp#392).
      idempotentHint: false,
      openWorldHint: false,
    },
    callback: async ({ datasourceId, confirm, tag }, extra): Promise<CallToolResult> => {
      const configWithOverrides = await extra.getConfigWithOverrides();

      return await deleteDatasourceTool.logAndExecute<string>({
        extra,
        args: { datasourceId, confirm, tag },
        callback: async () => {
          return await useRestApi({
            ...extra,
            jwtScopes: deleteDatasourceTool.requiredApiScopes,
            callback: async (restApi) => {
              const siteId = restApi.siteId;

              // Treat undefined, empty, and whitespace-only tags as "use the default" so a blank
              // label never gets applied (preview) or verified against (confirm).
              const pendingTag = tag?.trim() || DEFAULT_PENDING_DELETION_TAG;

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

              // Resolve identity so both the audit record and the response name the data source,
              // project, and owner. Reuse the data source already fetched by the access check when a
              // project/tag scope forced it, otherwise fetch it now.
              const resolveTarget = async (): Promise<MutationTarget> => {
                const datasource =
                  isDatasourceAllowedResult.content ??
                  (await restApi.datasourcesMethods.queryDatasource({ datasourceId, siteId }));
                const ownerEmail = await resolveOwnerEmail(
                  restApi,
                  siteId,
                  datasource.owner?.id,
                  'delete-datasource',
                );
                return {
                  id: datasourceId,
                  name: datasource.name,
                  project: datasource.project?.name,
                  owner: ownerEmail ?? undefined,
                  kind: 'datasource',
                };
              };

              // Route the admin gate, tag-evidence gate, and authoritative audit through the shared
              // mutation guard. The guard re-fetches the data source on confirm and verifies the
              // pending-deletion tag; a confirm without a prior preview is rejected server-side.
              const guardResult = await guardMutation({
                restApi,
                extra,
                tool: 'delete-datasource',
                action: 'delete',
                mode: 'preview-confirm',
                phase: confirm ? 'confirm' : 'preview',
                evidence: new TagEvidence({ tag: pendingTag, kind: 'datasource' }),
                resolveTarget,
              });
              if (guardResult.isErr()) {
                return guardResult.error.toErr();
              }
              const { target, recordOutcome } = guardResult.value;
              const projectName = target.project ?? 'unknown project';
              const ownerText = target.owner ? `owner ${target.owner}` : 'owner unknown';

              if (confirm) {
                try {
                  await restApi.datasourcesMethods.deleteDatasource({ datasourceId, siteId });
                } catch (e) {
                  // Authorized-but-failed: record the terminal 'failed' outcome so the audit trail
                  // does not claim a deletion that never happened, then rethrow to the tool's handler.
                  recordOutcome({ ok: false, failureDetail: getExceptionMessage(e) });
                  throw e;
                }
                recordOutcome({ ok: true });
                return new Ok(
                  `Deleted data source '${target.name}' (id ${datasourceId}) in '${projectName}', ${ownerText}. ` +
                    `On Tableau Cloud it can be restored from the recycle bin (${RECYCLE_BIN_DOC_URL}) for a ` +
                    'limited time before permanent removal; on Tableau Server deletion is permanent. ' +
                    'Dependent workbooks and flows were not deleted but no longer have this data source.',
                );
              }

              // Preview phase: the guard has tagged the data source pending deletion. Warn about
              // dependents (tool-specific) and report. No deletion.
              const dependencyWarning = await describeDownstreamDependencies({
                restApi,
                datasourceId,
                disableMetadataApiRequests: configWithOverrides.disableMetadataApiRequests,
              });

              return new Ok(
                `Preview — data source '${target.name}' (id ${datasourceId}) in '${projectName}', ${ownerText}. ` +
                  `${dependencyWarning} ` +
                  `It has been tagged '${pendingTag}' (reversible). ` +
                  'NEXT STEP — REQUIRED: show this data source (name, project, owner) and its dependent ' +
                  'content to the user and ask them to explicitly confirm deleting it. Do NOT delete ' +
                  'without the user’s approval. ' +
                  'Once approved, call again with confirm: true (the server will verify this ' +
                  `'${pendingTag}' tag before deleting). ` +
                  'On Tableau Cloud deleted data sources are recoverable from the recycle bin ' +
                  `(${RECYCLE_BIN_DOC_URL}) for a limited time; on Tableau Server deletion is permanent.`,
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
    parts.push(`${workbooks.length} workbook(s): ${formatDependentNames(workbooks)}`);
  }
  if (flows.length > 0) {
    parts.push(`${flows.length} flow(s): ${formatDependentNames(flows)}`);
  }
  return `⚠️ WARNING: deleting this data source may break ${parts.join(' and ')}.`;
}

// Cap the number of dependent names listed so a data source with thousands of dependents does not
// produce an unbounded message. The total count is always reported; only the name list is capped.
const MAX_DEPENDENT_NAMES_LISTED = 10;

function formatDependentNames(contents: ReadonlyArray<{ name: string }>): string {
  const names = contents.slice(0, MAX_DEPENDENT_NAMES_LISTED).map((c) => c.name);
  const remaining = contents.length - names.length;
  const listed = names.join(', ');
  return remaining > 0 ? `${listed}, …and ${remaining} more` : listed;
}
