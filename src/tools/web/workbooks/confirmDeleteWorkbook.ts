import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { getConfig } from '../../../config.js';
import { WorkbookNotAllowedError } from '../../../errors/mcpToolError.js';
import { getFeatureGate } from '../../../features/featureGate.js';
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
  workbookId: z.string().describe('The LUID of the workbook to delete.'),
};

/**
 * confirm-delete-workbook — the human-gesture confirm step of the MCP-Apps HITL flow for
 * delete-workbook (W-23125362, AC-5 closure).
 *
 * This tool is APP-ONLY (`meta.ui.visibility = ['app']`), so it is invisible to and uncallable by
 * the model — exactly like get-oauth-token. The ONLY path that reaches it is a human clicking
 * "Confirm" inside the rendered MCP-Apps iframe, which calls back via `app.callServerTool`. The
 * destructive `deleteWorkbook` REST call lives ONLY here.
 *
 * The guard verifies BOTH (AllEvidence):
 *   - a fresh in-iframe human approval (AppApprovalEvidence) recorded by the delete-workbook preview
 *     within the MUTATION_PREVIEW_TTL_MINUTES window, single-use; and
 *   - the live `pending-deletion` tag (TagEvidence), re-fetched server-side and un-forgeable.
 * Either missing → PreviewNotRunError, no delete. The composite can only ever narrow access.
 *
 * Gated behind the off-by-default `mcp-apps` flag AND ADMIN_TOOLS_ENABLED, so when the flag is off
 * the model never sees a destructive tool that lacks a preview path.
 */
export const getConfirmDeleteWorkbookTool = (
  server: WebMcpServer,
): WebTool<typeof paramsSchema> => {
  const config = getConfig();

  const confirmDeleteWorkbookTool = new WebTool({
    server,
    name: 'confirm-delete-workbook',
    disabled: !config.adminToolsEnabled || !getFeatureGate().isFeatureEnabled('mcp-apps'),
    description: `
Confirms and permanently deletes a workbook previously previewed by \`delete-workbook\`. This tool is
**not visible to the model** — it is invoked only by an explicit human confirmation gesture inside
the rendered MCP App interface, never by the assistant.

Before deleting, the server re-verifies BOTH that the workbook is still tagged pending deletion AND
that a human approved the deletion in the App within the allowed time window. If either check fails
the deletion is rejected and the user must preview again.
`.trim(),
    paramsSchema,
    annotations: {
      title: 'Confirm Delete Workbook',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    meta: {
      ui: {
        visibility: ['app'], // Only the App can call this; never the model.
      },
    },
    callback: async ({ workbookId }, extra): Promise<CallToolResult> => {
      return await confirmDeleteWorkbookTool.logAndExecute<string>({
        extra,
        args: { workbookId },
        callback: async () => {
          return await useRestApi({
            ...extra,
            jwtScopes: confirmDeleteWorkbookTool.requiredApiScopes,
            callback: async (restApi) => {
              const siteId = restApi.siteId;

              // Honor tool-scoping (bounded context) before any read/write, exactly as delete-workbook.
              const isWorkbookAllowedResult = await resourceAccessChecker.isWorkbookAllowed({
                workbookId,
                extra,
              });
              if (!isWorkbookAllowedResult.allowed) {
                return new WorkbookNotAllowedError(isWorkbookAllowedResult.message).toErr();
              }

              const resolveTarget = async (): Promise<MutationTarget> => {
                const workbook =
                  isWorkbookAllowedResult.content ??
                  (await restApi.workbooksMethods.getWorkbook({ workbookId, siteId }));
                const ownerEmail = await resolveOwnerEmail(
                  restApi,
                  siteId,
                  workbook.owner?.id,
                  'confirm-delete-workbook',
                );
                return {
                  id: workbookId,
                  name: workbook.name,
                  project: workbook.project?.name,
                  owner: ownerEmail ?? undefined,
                  kind: 'workbook',
                };
              };

              // Require BOTH the live pending-deletion tag (durable, un-forgeable) AND a fresh
              // single-use in-iframe human approval. Order: tag (non-consuming) first so a missing
              // tag never wastes the one-shot approval; approval second.
              const guardResult = await guardMutation({
                restApi,
                extra,
                tool: 'confirm-delete-workbook',
                previewTool: 'delete-workbook',
                action: 'delete',
                mode: 'preview-confirm',
                phase: 'confirm',
                evidence: new AllEvidence([
                  new TagEvidence({ tag: DEFAULT_PENDING_DELETION_TAG, kind: 'workbook' }),
                  new AppApprovalEvidence('delete-workbook'),
                ]),
                resolveTarget,
              });
              if (guardResult.isErr()) {
                return guardResult.error.toErr();
              }
              const { target } = guardResult.value;
              const projectName = target.project ?? 'unknown project';
              const ownerText = target.owner ? `owner ${target.owner}` : 'owner unknown';

              await restApi.workbooksMethods.deleteWorkbook({ workbookId, siteId });
              return new Ok(
                `Deleted workbook '${target.name}' (id ${workbookId}) in '${projectName}', ${ownerText}. ` +
                  `It can be restored from the Tableau recycle bin (${RECYCLE_BIN_DOC_URL}) for a ` +
                  'limited time before permanent removal.',
              );
            },
          });
        },
        constrainSuccessResult: (result) => ({ type: 'success', result }),
      });
    },
  });

  return confirmDeleteWorkbookTool;
};
