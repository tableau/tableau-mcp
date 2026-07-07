import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { getConfig } from '../../../config.js';
import { DatasourceNotAllowedError } from '../../../errors/mcpToolError.js';
import { getFeatureGate } from '../../../features/init.js';
import { useRestApi } from '../../../restApiInstance.js';
import { WebMcpServer } from '../../../server.web.js';
import {
  AllEvidence,
  AppApprovalEvidence,
  DEFAULT_PENDING_DELETION_TAG,
  TagEvidence,
} from '../_lib/evidence.js';
import { guardMutation, MutationTarget } from '../_lib/mutationGuard.js';
import { resourceAccessChecker } from '../resourceAccessChecker.js';
import { WebTool } from '../tool.js';
import { resolveOwnerEmail } from '../users/resolveOwnerEmail.js';

const RECYCLE_BIN_DOC_URL = 'https://help.tableau.com/current/pro/desktop/en-us/recycle_bin.htm';

const paramsSchema = {
  datasourceId: z.string().describe('The LUID of the published data source to delete.'),
};

/**
 * confirm-delete-datasource — the human-gesture confirm step of the MCP-Apps HITL flow for
 * delete-datasource (W-23202047, mirroring confirm-delete-workbook).
 *
 * This tool is APP-ONLY (`meta.ui.visibility = ['app']`), so it is invisible to and uncallable by
 * the model — exactly like confirm-delete-workbook. The ONLY path that reaches it is a human clicking
 * "Confirm" inside the rendered MCP-Apps iframe, which calls back via `app.callServerTool`. The
 * destructive `deleteDatasource` REST call lives ONLY here.
 *
 * The guard verifies BOTH (AllEvidence):
 *   - a fresh in-iframe human approval (AppApprovalEvidence, namespace 'delete-datasource') recorded
 *     by the delete-datasource preview within the MUTATION_PREVIEW_TTL_MINUTES window, single-use; and
 *   - the live `pending-deletion` tag (TagEvidence), re-fetched server-side and un-forgeable.
 * Either missing → PreviewNotRunError, no delete. The composite can only ever narrow access.
 *
 * Gated behind the off-by-default `mcp-apps` flag AND ADMIN_TOOLS_ENABLED, so when the flag is off
 * the model never sees a destructive tool that lacks a preview path.
 */
export const getConfirmDeleteDatasourceTool = (
  server: WebMcpServer,
): WebTool<typeof paramsSchema> => {
  const config = getConfig();

  const confirmDeleteDatasourceTool = new WebTool({
    server,
    name: 'confirm-delete-datasource',
    disabled: !config.adminToolsEnabled || !getFeatureGate().isFeatureEnabled('mcp-apps'),
    description: `
Confirms and permanently deletes a published data source previously previewed by \`delete-datasource\`.
This tool is **not visible to the model** — it is invoked only by an explicit human confirmation
gesture inside the rendered MCP App interface, never by the assistant.

Before deleting, the server re-verifies BOTH that the data source is still tagged pending deletion AND
that a human approved the deletion in the App within the allowed time window. If either check fails
the deletion is rejected and the user must preview again.
`.trim(),
    paramsSchema,
    annotations: {
      title: 'Confirm Delete Datasource',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
    meta: {
      ui: {
        visibility: ['app'], // Only the App can call this; never the model.
      },
    },
    callback: async ({ datasourceId }, extra): Promise<CallToolResult> => {
      return await confirmDeleteDatasourceTool.logAndExecute<string>({
        extra,
        args: { datasourceId },
        callback: async () => {
          return await useRestApi({
            ...extra,
            jwtScopes: confirmDeleteDatasourceTool.requiredApiScopes,
            callback: async (restApi) => {
              const siteId = restApi.siteId;

              // Honor tool-scoping (bounded context) before any read/write, exactly as delete-datasource.
              const isDatasourceAllowedResult = await resourceAccessChecker.isDatasourceAllowed({
                datasourceLuid: datasourceId,
                extra,
              });
              if (!isDatasourceAllowedResult.allowed) {
                return new DatasourceNotAllowedError(isDatasourceAllowedResult.message).toErr();
              }

              const resolveTarget = async (): Promise<MutationTarget> => {
                const datasource =
                  isDatasourceAllowedResult.content ??
                  (await restApi.datasourcesMethods.queryDatasource({ datasourceId, siteId }));
                const ownerEmail = await resolveOwnerEmail(
                  restApi,
                  siteId,
                  datasource.owner?.id,
                  'confirm-delete-datasource',
                );
                return {
                  id: datasourceId,
                  name: datasource.name,
                  project: datasource.project?.name,
                  owner: ownerEmail ?? undefined,
                  kind: 'datasource',
                };
              };

              // Require BOTH the live pending-deletion tag (durable, un-forgeable) AND a fresh
              // single-use in-iframe human approval. Order: tag (non-consuming) first so a missing
              // tag never wastes the one-shot approval; approval second.
              const guardResult = await guardMutation({
                restApi,
                extra,
                tool: 'confirm-delete-datasource',
                previewTool: 'delete-datasource',
                action: 'delete',
                mode: 'preview-confirm',
                phase: 'confirm',
                evidence: new AllEvidence([
                  new TagEvidence({ tag: DEFAULT_PENDING_DELETION_TAG, kind: 'datasource' }),
                  new AppApprovalEvidence('delete-datasource'),
                ]),
                resolveTarget,
              });
              if (guardResult.isErr()) {
                return guardResult.error.toErr();
              }
              const { target } = guardResult.value;
              const projectName = target.project ?? 'unknown project';
              const ownerText = target.owner ? `owner ${target.owner}` : 'owner unknown';

              await restApi.datasourcesMethods.deleteDatasource({ datasourceId, siteId });
              return new Ok(
                `Deleted data source '${target.name}' (id ${datasourceId}) in '${projectName}', ${ownerText}. ` +
                  `On Tableau Cloud it can be restored from the recycle bin (${RECYCLE_BIN_DOC_URL}) for a ` +
                  'limited time before permanent removal; on Tableau Server deletion is permanent. ' +
                  'Dependent workbooks and flows were not deleted but no longer have this data source.',
              );
            },
          });
        },
        constrainSuccessResult: (result) => ({ type: 'success', result }),
      });
    },
  });

  return confirmDeleteDatasourceTool;
};
