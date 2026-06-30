import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { getConfig } from '../../../config.js';
import { UnknownError } from '../../../errors/mcpToolError.js';
import { getFeatureGate } from '../../../features/featureGate.js';
import { useRestApi } from '../../../restApiInstance.js';
import { updateCloudExtractRefreshScheduleSchema } from '../../../sdks/tableau/types/extractRefreshTask.js';
import { WebMcpServer } from '../../../server.web.js';
import { AppApprovalEvidence } from '../_lib/evidence.js';
import { guardMutation, MutationTarget } from '../_lib/mutationGuard.js';
import { WebTool } from '../tool.js';

const paramsSchema = {
  taskId: z.string().uuid('taskId must be a valid UUID'),
  schedule: updateCloudExtractRefreshScheduleSchema,
};

/**
 * confirm-update-cloud-extract-refresh-task — the human-gesture confirm step of the MCP-Apps HITL
 * flow for update-cloud-extract-refresh-task (W-23202047, mirroring confirm-delete-workbook).
 *
 * This tool is APP-ONLY (`meta.ui.visibility = ['app']`), so it is invisible to and uncallable by
 * the model. The ONLY path that reaches it is a human clicking "Apply schedule change" inside the
 * rendered MCP-Apps iframe, which calls back via `app.callServerTool`. The mutating
 * `updateCloudExtractRefreshTask` REST call lives ONLY here.
 *
 * This is a SCHEDULE CHANGE, not a deletion. The task has no durable, taggable state, so the human
 * gesture in the iframe IS the proof: the guard verifies a fresh, single-use in-iframe human approval
 * (AppApprovalEvidence, namespace 'update-cloud-extract-refresh-task') recorded by the
 * update-cloud-extract-refresh-task preview within the MUTATION_PREVIEW_TTL_MINUTES window. Missing
 * approval → PreviewNotRunError, no update.
 *
 * Gated behind the off-by-default `mcp-apps` flag AND ADMIN_TOOLS_ENABLED, so when the flag is off
 * the model never sees a mutating tool that lacks a preview path.
 */
export const getConfirmUpdateCloudExtractRefreshTaskTool = (
  server: WebMcpServer,
): WebTool<typeof paramsSchema> => {
  const config = getConfig();

  const confirmUpdateCloudExtractRefreshTaskTool = new WebTool({
    server,
    name: 'confirm-update-cloud-extract-refresh-task',
    disabled: !config.adminToolsEnabled || !getFeatureGate().isFeatureEnabled('mcp-apps'),
    description: `
Confirms and applies a schedule change to an extract refresh task on Tableau Cloud, previously
previewed by \`update-cloud-extract-refresh-task\`. This tool is **not visible to the model** — it is
invoked only by an explicit human confirmation gesture inside the rendered MCP App interface, never by
the assistant.

Before applying the change, the server re-verifies that a human approved it in the App within the
allowed time window. If the check fails the update is rejected and the user must preview again. The
update overwrites the existing schedule wholesale; to revert, run the tool again with the prior
schedule values.
`.trim(),
    paramsSchema,
    annotations: {
      title: 'Confirm Update Cloud Extract Refresh Task',
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
    callback: async (args, extra): Promise<CallToolResult> => {
      return await confirmUpdateCloudExtractRefreshTaskTool.logAndExecute<string>({
        extra,
        args,
        callback: async () => {
          return await useRestApi({
            ...extra,
            jwtScopes: confirmUpdateCloudExtractRefreshTaskTool.requiredApiScopes,
            callback: async (restApi) => {
              // The task carries no durable taggable state; the human gesture in the iframe is the
              // proof. name/project may be undefined for a task — that's fine, the audit schema allows it.
              const resolveTarget = async (): Promise<MutationTarget> => ({
                id: args.taskId,
                kind: 'extract-refresh-task',
              });

              // Require a fresh, single-use in-iframe human approval recorded by the preview.
              const guardResult = await guardMutation({
                restApi,
                extra,
                tool: 'confirm-update-cloud-extract-refresh-task',
                action: 'update',
                mode: 'preview-confirm',
                phase: 'confirm',
                evidence: new AppApprovalEvidence('update-cloud-extract-refresh-task'),
                resolveTarget,
              });
              if (guardResult.isErr()) {
                return guardResult.error.toErr();
              }

              const result = await restApi.tasksMethods.updateCloudExtractRefreshTask({
                siteId: restApi.siteId,
                taskId: args.taskId,
                schedule: args.schedule,
              });

              if (result.isErr()) {
                if (result.error.type === 'tableau-api') {
                  const { status, code, summary, detail } = result.error;
                  // 404 from Cloud commonly means the tool was called against a Tableau Server
                  // site or the taskId doesn't exist on this site — surface a Cloud-only hint
                  // instead of the bare "Not Found".
                  if (status === 404) {
                    const codeStr = code ? ` [${code}]` : '';
                    return new UnknownError(
                      `Tableau 404${codeStr}: extract refresh task '${args.taskId}' not found. This tool is Tableau Cloud only — verify you're connected to a Cloud site (not Server) and that the taskId came from list-extract-refresh-tasks.`,
                      404,
                    ).toErr();
                  }
                  const codeStr = code ? ` [${code}]` : '';
                  const summaryDetail = [summary, detail].filter(Boolean).join(': ');
                  const tail = summaryDetail ? `: ${summaryDetail}` : '';
                  return new UnknownError(`Tableau ${status}${codeStr}${tail}`, status).toErr();
                }
                return new UnknownError(result.error.message).toErr();
              }

              const updated = result.value;
              // Fall back to args for every field — the Cloud response payload varies by site
              // and we don't want a partial response to produce a misleading message.
              const frequency = updated.schedule?.frequency ?? args.schedule.frequency;
              const start =
                updated.schedule?.frequencyDetails?.start ?? args.schedule.frequencyDetails.start;
              const end =
                updated.schedule?.frequencyDetails?.end ?? args.schedule.frequencyDetails.end;
              const window = end ? ` (${start}–${end})` : ` (start ${start})`;
              return new Ok(
                `Extract refresh task '${args.taskId}' has been successfully updated. New schedule: ${frequency}${window}.`,
              );
            },
          });
        },
        constrainSuccessResult: (result) => ({ type: 'success', result }),
      });
    },
  });

  return confirmUpdateCloudExtractRefreshTaskTool;
};
