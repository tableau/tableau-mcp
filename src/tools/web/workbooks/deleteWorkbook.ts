import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { createHash } from 'crypto';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { getConfig } from '../../../config.js';
import { AdminOnlyError, ArgsValidationError } from '../../../errors/mcpToolError.js';
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

/**
 * Deterministic confirmation token derived from the site + workbook. The preview phase returns it;
 * the delete phase requires it. Because the value is only obtainable by running the preview, this
 * forces a genuine two-step (preview → confirm) flow and prevents a blind single-call delete.
 * Stateless by design (no server-side nonce store) so it works across server instances and restarts.
 */
export function computeConfirmationToken(siteId: string, workbookId: string): string {
  return createHash('sha256').update(`${siteId}:${workbookId}`).digest('hex').slice(0, 12);
}

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
  confirmationToken: z
    .string()
    .optional()
    .describe(
      'Required when confirm is true. The confirmationToken returned by the preview step ' +
        '(confirm omitted/false) for this workbook. Deletion is rejected without a matching token, ' +
        'which guarantees a preview was run first.',
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
   workbook name, project, and owner, returns a \`confirmationToken\`, and does **not** delete
   anything.
2. **Delete (\`confirm: true\` + \`confirmationToken\`):** permanently removes the workbook. The
   token from step 1 is required — deletion is rejected without it, which guarantees the preview
   was run first. On Tableau Cloud the workbook is moved to the recycle bin and can be restored
   for a limited time before permanent removal (see ${RECYCLE_BIN_DOC_URL}).

**Required human confirmation (do not skip):** This permanently deletes content. After the
preview step you MUST present its result to the user — the workbook name, project, and owner —
and ask the user to explicitly confirm deletion of that specific workbook. Only after the user
approves should you call again with \`confirm: true\` and the \`confirmationToken\`. Never run the
preview and the delete back-to-back on your own, never auto-confirm, and never fabricate or
compute the \`confirmationToken\` yourself — always use the exact value returned by the preview.
If the user does not clearly approve, stop and do not delete.

**Parameters:**
- \`workbookId\` (required) – The LUID of the workbook. Obtain it from \`list-workbooks\`.
- \`confirm\` (optional) – Set \`true\` to perform the deletion. Defaults to preview.
- \`confirmationToken\` (optional) – Required when \`confirm\` is true; the token from the preview step.

**Note:** Deletion is reversible only via the recycle bin and only for a limited window. Always
run the preview first, surface it to the user, and obtain explicit approval before deleting.
`.trim(),
    paramsSchema,
    annotations: {
      title: 'Delete Workbook',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    callback: async (
      { workbookId, confirm, confirmationToken },
      extra,
    ): Promise<CallToolResult> => {
      return await deleteWorkbookTool.logAndExecute<string>({
        extra,
        args: { workbookId, confirm, confirmationToken },
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
              const expectedToken = computeConfirmationToken(siteId, workbookId);

              // Gate the destructive path on the preview-issued token BEFORE any read or write.
              // The token is only obtainable by running the preview, so a missing/mismatched
              // token means no preview was run for this workbook — reject without side effects.
              if (confirm && confirmationToken !== expectedToken) {
                return new ArgsValidationError(
                  'Deletion requires the confirmationToken returned by the preview step. ' +
                    'Run delete-workbook with confirm omitted (or false) for this workbookId first, ' +
                    'then call again with confirm: true and the confirmationToken from that response.',
                ).toErr();
              }

              // Resolve identity in both phases so the response (preview AND the final delete
              // confirmation) always names the workbook, project, and owner for an auditable
              // record of exactly what was acted on.
              const workbook = await restApi.workbooksMethods.getWorkbook({ workbookId, siteId });
              const ownerEmail = await resolveOwnerEmail(restApi, siteId, workbook.owner?.id);
              const projectName = workbook.project?.name ?? 'unknown project';
              const ownerText = ownerEmail ? `owner ${ownerEmail}` : 'owner unknown';

              if (confirm) {
                await restApi.workbooksMethods.deleteWorkbook({ workbookId, siteId });
                return new Ok(
                  `Deleted workbook '${workbook.name}' (id ${workbookId}) in '${projectName}', ${ownerText}. ` +
                    `It can be restored from the Tableau recycle bin (${RECYCLE_BIN_DOC_URL}) for a ` +
                    'limited time before permanent removal.',
                );
              }

              // Preview phase: tag as pending deletion and report. No deletion.
              await restApi.workbooksMethods.addTagsToWorkbook({
                workbookId,
                siteId,
                tagLabels: [STALE_PENDING_DELETION_TAG],
              });

              return new Ok(
                `Preview — workbook '${workbook.name}' (id ${workbookId}) in '${projectName}', ${ownerText}. ` +
                  `It has been tagged '${STALE_PENDING_DELETION_TAG}' (reversible). ` +
                  'NEXT STEP — REQUIRED: show this workbook (name, project, owner) to the user and ask them ' +
                  'to explicitly confirm deleting it. Do NOT delete without the user’s approval. ' +
                  `Once approved, call again with confirm: true and confirmationToken: ${expectedToken}. ` +
                  `Deleted workbooks are recoverable from the Tableau recycle bin (${RECYCLE_BIN_DOC_URL}) ` +
                  'for a limited time.',
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
