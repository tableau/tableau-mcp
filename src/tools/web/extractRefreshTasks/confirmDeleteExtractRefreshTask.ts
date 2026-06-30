import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { getConfig } from '../../../config.js';
import { getFeatureGate } from '../../../features/featureGate.js';
import { useRestApi } from '../../../restApiInstance.js';
import { WebMcpServer } from '../../../server.web.js';
import { AppApprovalEvidence } from '../_lib/evidence.js';
import { guardMutation, MutationTarget } from '../_lib/mutationGuard.js';
import { WebTool } from '../tool.js';

const paramsSchema = {
  taskId: z.string().uuid('taskId must be a valid UUID'),
};

/**
 * confirm-delete-extract-refresh-task — the human-gesture confirm step of the MCP-Apps HITL flow for
 * delete-extract-refresh-task (W-23202047, mirroring confirm-delete-workbook).
 *
 * This tool is APP-ONLY (`meta.ui.visibility = ['app']`), so it is invisible to and uncallable by
 * the model. The ONLY path that reaches it is a human clicking "Confirm" inside the rendered
 * MCP-Apps iframe, which calls back via `app.callServerTool`. The destructive
 * `deleteExtractRefreshTask` REST call lives ONLY here.
 *
 * Because an extract refresh task has no durable, taggable state, the human gesture in the iframe IS
 * the proof for the app flow: the guard verifies a fresh, single-use in-iframe human approval
 * (AppApprovalEvidence, namespace 'delete-extract-refresh-task') recorded by the
 * delete-extract-refresh-task preview within the MUTATION_PREVIEW_TTL_MINUTES window. (The preview's
 * server-generated nonce is only for the flag-OFF model path; the app does not carry it.) Missing
 * approval → PreviewNotRunError, no delete.
 *
 * Gated behind the off-by-default `mcp-apps` flag AND ADMIN_TOOLS_ENABLED, so when the flag is off
 * the model never sees a destructive tool that lacks a preview path.
 */
export const getConfirmDeleteExtractRefreshTaskTool = (
  server: WebMcpServer,
): WebTool<typeof paramsSchema> => {
  const config = getConfig();

  const confirmDeleteExtractRefreshTaskTool = new WebTool({
    server,
    name: 'confirm-delete-extract-refresh-task',
    disabled: !config.adminToolsEnabled || !getFeatureGate().isFeatureEnabled('mcp-apps'),
    description: `
Confirms and permanently deletes an extract refresh task previously previewed by
\`delete-extract-refresh-task\`. This tool is **not visible to the model** — it is invoked only by an
explicit human confirmation gesture inside the rendered MCP App interface, never by the assistant.

Before deleting, the server re-verifies that a human approved the deletion in the App within the
allowed time window. If the check fails the deletion is rejected and the user must preview again. This
operation is permanent and irreversible — the extract refresh task cannot be recovered once deleted.
`.trim(),
    paramsSchema,
    annotations: {
      title: 'Confirm Delete Extract Refresh Task',
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
    callback: async ({ taskId }, extra): Promise<CallToolResult> => {
      return await confirmDeleteExtractRefreshTaskTool.logAndExecute<string>({
        extra,
        args: { taskId },
        callback: async () => {
          return await useRestApi({
            ...extra,
            jwtScopes: confirmDeleteExtractRefreshTaskTool.requiredApiScopes,
            callback: async (restApi) => {
              const siteId = restApi.siteId;

              // The task carries no durable taggable state; the human gesture in the iframe is the
              // proof. name/project may be undefined for a task — that's fine, the audit schema allows it.
              const resolveTarget = async (): Promise<MutationTarget> => ({
                id: taskId,
                kind: 'extract-refresh-task',
              });

              // Require a fresh, single-use in-iframe human approval recorded by the preview.
              const guardResult = await guardMutation({
                restApi,
                extra,
                tool: 'confirm-delete-extract-refresh-task',
                previewTool: 'delete-extract-refresh-task',
                action: 'delete',
                mode: 'preview-confirm',
                phase: 'confirm',
                evidence: new AppApprovalEvidence('delete-extract-refresh-task'),
                resolveTarget,
              });
              if (guardResult.isErr()) {
                return guardResult.error.toErr();
              }

              await restApi.tasksMethods.deleteExtractRefreshTask({ siteId, taskId });
              return new Ok(
                `Extract refresh task '${taskId}' has been successfully deleted. The underlying data source or workbook is unaffected, but it will no longer be refreshed on this schedule.`,
              );
            },
          });
        },
        constrainSuccessResult: (result) => ({ type: 'success', result }),
      });
    },
  });

  return confirmDeleteExtractRefreshTaskTool;
};
