import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { getConfig } from '../../../config.js';
import { useRestApi } from '../../../restApiInstance.js';
import { WebMcpServer } from '../../../server.web.js';
import { RegistryEvidence } from '../_lib/evidence.js';
import { guardMutation, MutationTarget } from '../_lib/mutationGuard.js';
import { WebTool } from '../tool.js';

const paramsSchema = {
  taskId: z.string().uuid('taskId must be a valid UUID'),
  confirm: z
    .boolean()
    .optional()
    .describe(
      'When omitted or false, runs a non-destructive preview: reports what would be deleted and ' +
        'returns a single-use confirmation token. When true, deletes the extract refresh task — but ' +
        'only if the confirmation token from a prior preview call is supplied (the server verifies ' +
        'and consumes it). This gate genuinely requires the preview phase to have run.',
    ),
  confirmationToken: z
    .string()
    .optional()
    .describe(
      'The single-use confirmation token returned by a prior preview call for this taskId. Required ' +
        'when confirm is true; ignored otherwise.',
    ),
};

export const getDeleteExtractRefreshTaskTool = (
  server: WebMcpServer,
): WebTool<typeof paramsSchema> => {
  const config = getConfig();

  const deleteExtractRefreshTaskTool = new WebTool({
    server,
    name: 'delete-extract-refresh-task',
    disabled: !config.adminToolsEnabled,
    description: `
  Deletes an extract refresh task from the Tableau site. This permanently removes the scheduled extract refresh — the underlying data source or workbook is not affected, but it will no longer be refreshed on this schedule.

  This tool is restricted to Tableau site administrators and requires the \`ADMIN_TOOLS_ENABLED\` feature flag to be enabled.

  This tool is **two-phase** to keep the destructive action safe:

  1. **Preview (default — \`confirm\` omitted or false):** reports what would be deleted and returns a single-use confirmation token. Nothing is deleted.
  2. **Delete (\`confirm: true\`):** permanently removes the task. Requires the \`confirmationToken\` from a prior preview call (the server verifies and consumes it). The token is server-generated and unguessable, so this gate genuinely requires the preview phase to have run; it cannot be bypassed by computing a value.

  **Required human confirmation:** After preview, present the task to the user and get explicit approval before calling again with \`confirm: true\`. Do not auto-confirm — get the user's explicit approval first.

  Use this tool when you need to:
  - Remove a scheduled extract refresh that is no longer needed
  - Disable refresh schedules for under-used or decommissioned content
  - Optimize site resources by eliminating unnecessary extract refreshes

  **Parameters:**
  - \`taskId\` (required) – The ID of the extract refresh task to delete. Obtain this from the \`list-extract-refresh-tasks\` tool.
  - \`confirm\` (optional) – Set \`true\` to perform the deletion (requires the confirmation token from a prior preview). Defaults to preview.
  - \`confirmationToken\` (optional) – The single-use token returned by the preview call. Required when \`confirm\` is true.

  **Response:** A confirmation message indicating the task was successfully deleted, or — in preview — the confirmation token to supply on the confirmed call.

  **Note:** This operation is irreversible. The extract refresh task cannot be recovered once deleted. To re-enable scheduled refreshes, a new task must be created. Tableau Cloud uses \`tableau:tasks:delete\` scope.
  `,
    paramsSchema,
    annotations: {
      title: 'Delete Extract Refresh Task',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
    callback: async ({ taskId, confirm, confirmationToken }, extra): Promise<CallToolResult> => {
      return await deleteExtractRefreshTaskTool.logAndExecute<string>({
        extra,
        args: { taskId, confirm, confirmationToken },
        callback: async () => {
          return await useRestApi({
            ...extra,
            jwtScopes: deleteExtractRefreshTaskTool.requiredApiScopes,
            callback: async (restApi) => {
              const siteId = restApi.siteId;

              // The task carries no durable taggable state, so the preview→confirm gate uses a
              // server-generated single-use nonce (RegistryEvidence) instead of a pending-deletion
              // tag. name/project may be undefined for a task — that's fine, the audit schema allows it.
              const resolveTarget = async (): Promise<MutationTarget> => ({
                id: taskId,
                kind: 'extract-refresh-task',
              });

              const evidence = new RegistryEvidence();

              // Route the admin gate, nonce-evidence gate, and authoritative audit through the shared
              // mutation guard. On confirm the guard verifies and consumes the supplied token; a
              // confirm without a valid prior-preview token is rejected server-side.
              const guardResult = await guardMutation({
                restApi,
                extra,
                tool: 'delete-extract-refresh-task',
                action: 'delete',
                mode: 'preview-confirm',
                phase: confirm ? 'confirm' : 'preview',
                evidence,
                resolveTarget,
                confirmationToken,
              });
              if (guardResult.isErr()) {
                return guardResult.error.toErr();
              }

              if (confirm) {
                await restApi.tasksMethods.deleteExtractRefreshTask({ siteId, taskId });
                return new Ok(
                  `Extract refresh task '${taskId}' has been successfully deleted. The underlying data source or workbook is unaffected, but it will no longer be refreshed on this schedule.`,
                );
              }

              // Preview phase: the guard minted a single-use confirmation token. Surface it so the
              // caller can supply it on the confirmed call. No deletion.
              const nonce = evidence.getEstablishedNonce();
              return new Ok(
                `Preview — extract refresh task '${taskId}' would be permanently deleted (the underlying ` +
                  'data source or workbook is unaffected, but it will no longer be refreshed on this ' +
                  'schedule). ' +
                  'NEXT STEP — REQUIRED: present this task to the user and ask them to explicitly confirm ' +
                  'deleting it. Do NOT delete without the user’s approval. ' +
                  `Once approved, call again with confirm: true and confirmationToken: "${nonce}" ` +
                  '(the server will verify and consume this single-use token before deleting).',
              );
            },
          });
        },
        constrainSuccessResult: (result) => ({ type: 'success', result }),
      });
    },
  });

  return deleteExtractRefreshTaskTool;
};
