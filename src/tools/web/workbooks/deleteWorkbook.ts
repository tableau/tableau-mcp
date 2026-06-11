import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { getConfig } from '../../../config.js';
import { AdminOnlyError } from '../../../errors/mcpToolError.js';
import { log } from '../../../logging/logger.js';
import { useRestApi } from '../../../restApiInstance.js';
import { RestApi } from '../../../sdks/tableau/restApi.js';
import { WebMcpServer } from '../../../server.web.js';
import { getExceptionMessage } from '../../../utils/getExceptionMessage.js';
import { assertAdmin } from '../adminGate.js';
import { WebTool } from '../tool.js';

const RECYCLE_BIN_DOC_URL = 'https://help.tableau.com/current/pro/desktop/en-us/recycle_bin.htm';

// Tag applied during the preview phase to mark a workbook as pending deletion. Reversible and
// visible in the Tableau UI, giving owners a window to object before the confirmed delete.
export const STALE_PENDING_DELETION_TAG = 'stale-pending-deletion';

const paramsSchema = {
  workbookId: z.string().describe('The LUID of the workbook to delete.'),
  confirm: z
    .boolean()
    .optional()
    .describe(
      'When omitted or false, runs a non-destructive preview: tags the workbook as pending ' +
        'deletion and reports what would be deleted. When true, permanently deletes the workbook ' +
        '(recoverable from the Tableau recycle bin for a limited time).',
    ),
};

export const getDeleteWorkbookTool = (server: WebMcpServer): WebTool<typeof paramsSchema> => {
  const config = getConfig();

  const deleteWorkbookTool = new WebTool({
    server,
    name: 'delete-workbook',
    disabled: !config.adminToolsEnabled,
    description: `
Deletes a workbook from the current Tableau Cloud site as the destructive step of the Stale
Content Cleanup workflow. Restricted to Tableau site administrators and requires the
\`ADMIN_TOOLS_ENABLED\` feature flag.

This tool is **two-phase** to keep the destructive action safe:

1. **Preview (default — \`confirm\` omitted or false):** tags the workbook with
   \`${STALE_PENDING_DELETION_TAG}\` (reversible, visible in the Tableau UI), reports the
   workbook name, project, and owner, and does **not** delete anything.
2. **Delete (\`confirm: true\`):** permanently removes the workbook. On Tableau Cloud the
   workbook is moved to the recycle bin and can be restored for a limited time before
   permanent removal (see ${RECYCLE_BIN_DOC_URL}).

**Parameters:**
- \`workbookId\` (required) – The LUID of the workbook. Obtain it from \`list-workbooks\`.
- \`confirm\` (optional) – Set \`true\` to perform the deletion. Defaults to preview.

**Note:** Deletion is reversible only via the recycle bin and only for a limited window. Always
run the preview first and confirm the workbook identity before deleting.
`.trim(),
    paramsSchema,
    annotations: {
      title: 'Delete Workbook',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    callback: async ({ workbookId, confirm }, extra): Promise<CallToolResult> => {
      return await deleteWorkbookTool.logAndExecute<string>({
        extra,
        args: { workbookId, confirm },
        callback: async () => {
          return await useRestApi({
            ...extra,
            jwtScopes: deleteWorkbookTool.requiredApiScopes,
            callback: async (restApi) => {
              const adminResult = await assertAdmin(restApi, extra);
              if (adminResult.isErr()) {
                return new AdminOnlyError(adminResult.error).toErr();
              }

              const siteId = restApi.siteId;

              if (confirm) {
                await restApi.workbooksMethods.deleteWorkbook({ workbookId, siteId });
                return new Ok(
                  `Workbook '${workbookId}' deleted. It can be restored from the Tableau ` +
                    `recycle bin (${RECYCLE_BIN_DOC_URL}) for a limited time before permanent removal.`,
                );
              }

              // Preview phase: resolve details, tag as pending deletion, report. No deletion.
              const workbook = await restApi.workbooksMethods.getWorkbook({ workbookId, siteId });
              const ownerEmail = await resolveOwnerEmail(restApi, siteId, workbook.owner?.id);

              await restApi.workbooksMethods.addTagsToWorkbook({
                workbookId,
                siteId,
                tagLabels: [STALE_PENDING_DELETION_TAG],
              });

              const projectName = workbook.project?.name ?? 'unknown project';
              const ownerText = ownerEmail ? `owner ${ownerEmail}` : 'owner unknown';

              return new Ok(
                `Preview — workbook '${workbook.name}' (id ${workbookId}) in '${projectName}', ${ownerText}. ` +
                  `It has been tagged '${STALE_PENDING_DELETION_TAG}' (reversible). ` +
                  'Call again with confirm: true to delete it. Deleted workbooks are recoverable from the ' +
                  `Tableau recycle bin (${RECYCLE_BIN_DOC_URL}) for a limited time.`,
              );
            },
          });
        },
        constrainSuccessResult: (result) => ({ type: 'success', result }),
      });
    },
  });

  return deleteWorkbookTool;
};

/**
 * Best-effort resolution of the workbook owner's email for the preview report. Owner lookup is
 * informational only (report-only notify), so a failure must not block the preview — we log and
 * fall back to no email.
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
      message: `delete-workbook: failed to resolve owner ${ownerId} for workbook preview`,
      level: 'warning',
      logger: 'delete-workbook',
      data: getExceptionMessage(error),
    });
    return null;
  }
}
