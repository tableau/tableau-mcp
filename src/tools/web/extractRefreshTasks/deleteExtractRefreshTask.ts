import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { getConfig } from '../../../config.js';
import { AdminOnlyError, ArgsValidationError } from '../../../errors/mcpToolError.js';
import { useRestApi } from '../../../restApiInstance.js';
import { WebMcpServer } from '../../../server.web.js';
import { assertAdmin } from '../adminGate.js';
import { WebTool } from '../tool.js';
import { computeConfirmationToken } from './updateCloudExtractRefreshTask.js';

const paramsSchema = {
  taskId: z.string().uuid('taskId must be a valid UUID'),
  confirm: z
    .boolean()
    .optional()
    .describe(
      'When omitted or false, runs a non-destructive preview: echoes the task that would be ' +
        'deleted and returns a confirmationToken without calling the Tableau API. When true, ' +
        'deletes the task — requires a matching confirmationToken from the preview step.',
    ),
  confirmationToken: z
    .string()
    .optional()
    .describe(
      'Required when confirm is true. The confirmationToken returned by the preview step ' +
        '(confirm omitted/false) for this taskId. The delete is rejected without a matching token ' +
        '— a friction gate requiring a deliberate second call. Note the token is a deterministic ' +
        'hash of caller-known inputs, so it adds deliberation but does not by itself prove a ' +
        'preview ran.',
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

  1. **Preview (default — \`confirm\` omitted or false):** echoes the task that would be deleted, returns a \`confirmationToken\`, and does **not** call the Tableau delete endpoint.
  2. **Delete (\`confirm: true\` + \`confirmationToken\`):** permanently deletes the task. The token from step 1 is required — deletion is rejected without it, a friction gate requiring a deliberate second call rather than a blind one-shot delete (the token is a deterministic hash of caller-known inputs, so it adds deliberation but does not by itself prove a preview ran).

  **Required human confirmation:** After preview, present the task ID to the user and get explicit approval before deleting. Do not auto-confirm or compute the \`confirmationToken\` yourself — use the exact value the preview returned.

  Use this tool when you need to:
  - Remove a scheduled extract refresh that is no longer needed
  - Disable refresh schedules for under-used or decommissioned content
  - Optimize site resources by eliminating unnecessary extract refreshes

  **Parameters:**
  - \`taskId\` (required) – The ID of the extract refresh task to delete. Obtain this from the \`list-extract-refresh-tasks\` tool.
  - \`confirm\` (optional) – Set \`true\` to perform the deletion. Defaults to preview.
  - \`confirmationToken\` (optional) – Required when \`confirm\` is true; the token from the preview step.

  **Response:** A preview message (with \`confirmationToken\`) or a confirmation message indicating the task was successfully deleted.

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
    callback: async (args, extra): Promise<CallToolResult> => {
      return await deleteExtractRefreshTaskTool.logAndExecute<string>({
        extra,
        args,
        callback: async () => {
          return await useRestApi({
            ...extra,
            jwtScopes: deleteExtractRefreshTaskTool.requiredApiScopes,
            callback: async (restApi) => {
              const adminResult = await assertAdmin(restApi, extra);
              if (adminResult.isErr()) {
                return new AdminOnlyError(adminResult.error).toErr();
              }

              const siteId = restApi.siteId;
              const expectedToken = computeConfirmationToken(siteId, args.taskId);

              // Gate the destructive path on the confirmation token BEFORE any write, so a missing
              // or mismatched token is rejected with zero side effects. Forces a deliberate
              // two-step delete; does not prove a preview ran (token is a deterministic hash of
              // caller-known inputs — see computeConfirmationToken).
              if (args.confirm && args.confirmationToken !== expectedToken) {
                return new ArgsValidationError(
                  'Deletion requires the confirmationToken returned by the preview step. ' +
                    'Run delete-extract-refresh-task with confirm omitted (or false) for this ' +
                    'taskId first, then call again with confirm: true and the confirmationToken from ' +
                    'that response.',
                ).toErr();
              }

              if (!args.confirm) {
                // Preview phase: echo the task that would be deleted plus the token. No call to
                // Tableau — the task's existence is verified on the apply call.
                return new Ok(
                  `Preview — would delete extract refresh task '${args.taskId}'. ` +
                    'This is irreversible: once deleted, the task cannot be recovered and the ' +
                    'underlying data source or workbook will no longer be refreshed on this schedule. ' +
                    'NEXT STEP — REQUIRED: present this task to the user and obtain explicit ' +
                    "approval. Do NOT delete without the user's approval in this conversation. " +
                    `Once approved, call again with confirm: true and confirmationToken: ${expectedToken}.`,
                );
              }

              await restApi.tasksMethods.deleteExtractRefreshTask({
                siteId,
                taskId: args.taskId,
              });

              return new Ok(
                `Extract refresh task '${args.taskId}' has been successfully deleted. The underlying data source or workbook is unaffected, but it will no longer be refreshed on this schedule.`,
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
