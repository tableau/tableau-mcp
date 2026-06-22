import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { createHash } from 'crypto';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { getConfig } from '../../../config.js';
import {
  AdminOnlyError,
  ArgsValidationError,
  WorkbookNotAllowedError,
} from '../../../errors/mcpToolError.js';
import { useRestApi } from '../../../restApiInstance.js';
import { WebMcpServer } from '../../../server.web.js';
import { assertAdmin } from '../adminGate.js';
import { resourceAccessChecker } from '../resourceAccessChecker.js';
import { WebTool } from '../tool.js';
import { resolveOwnerEmail } from '../users/resolveOwnerEmail.js';

const RECYCLE_BIN_DOC_URL = 'https://help.tableau.com/current/pro/desktop/en-us/recycle_bin.htm';

// Default tag applied during the preview phase to mark a workbook as pending deletion. Reversible
// and visible in the Tableau UI, giving owners a window to object before the confirmed delete.
// Generic by design — callers (e.g. the Stale Content Cleanup prompt) can override via the `tag`
// argument to use their own vocabulary.
export const DEFAULT_PENDING_DELETION_TAG = 'pending-deletion';

/**
 * Deterministic confirmation token derived from the site + workbook. The preview phase returns it;
 * the delete phase requires a matching value. This forces an explicit, deliberate second call with
 * a workbook-specific token rather than a blind one-shot delete.
 *
 * NOTE: this is a friction/correctness gate, NOT proof that a preview actually ran. The token is a
 * pure sha256(siteId:workbookId) — both inputs are known to any caller (siteId from the connected
 * site, workbookId from the tool arg), so a caller can compute it without previewing. Guaranteeing
 * a preview/tag step happened would require server-side state (e.g. gating on the pending-deletion
 * tag set during preview). Stateless by design so it works across server instances and restarts.
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
        '(confirm omitted/false) for this workbook. Deletion is rejected without a matching token ' +
        '— a friction gate requiring a distinct second call. Note the token is a deterministic hash ' +
        'of caller-known inputs, so it adds deliberation but does not by itself prove a preview ran.',
    ),
  tag: z
    .string()
    .optional()
    .describe(
      'Label applied to the workbook during the preview phase to mark it as pending deletion ' +
        `(reversible, visible in the Tableau UI). Defaults to '${DEFAULT_PENDING_DELETION_TAG}'.`,
    ),
};

export const getDeleteWorkbookTool = (server: WebMcpServer): WebTool<typeof paramsSchema> => {
  const config = getConfig();

  const deleteWorkbookTool = new WebTool({
    server,
    name: 'delete-workbook',
    disabled: !config.adminToolsEnabled,
    description: `
Permanently deletes a workbook from the current Tableau Cloud site. Restricted to Tableau site
administrators and requires the \`ADMIN_TOOLS_ENABLED\` feature flag.

This tool is **two-phase** to keep the destructive action safe:

1. **Preview (default — \`confirm\` omitted or false):** tags the workbook as pending deletion
   (reversible, visible in the Tableau UI; label configurable via \`tag\`, default
   \`${DEFAULT_PENDING_DELETION_TAG}\`), reports the workbook name, project, and owner, returns a
   \`confirmationToken\`, and does **not** delete anything.
2. **Delete (\`confirm: true\` + \`confirmationToken\`):** permanently removes the workbook. The
   token from step 1 is required — deletion is rejected without it, a friction gate requiring a
   deliberate second call rather than a blind one-shot delete (the token is a deterministic hash of
   caller-known inputs, so it adds deliberation but does not by itself prove a preview ran). On Tableau Cloud the workbook is moved to the recycle bin and can be restored
   for a limited time before permanent removal (see ${RECYCLE_BIN_DOC_URL}).

**Required human confirmation:** After preview, present the workbook (name, project, owner) to the
user and get explicit approval before deleting. Do not auto-confirm or compute the
\`confirmationToken\` yourself — use the exact value the preview returned.

**Parameters:**
- \`workbookId\` (required) – The LUID of the workbook. Obtain it from \`list-workbooks\`.
- \`confirm\` (optional) – Set \`true\` to perform the deletion. Defaults to preview.
- \`confirmationToken\` (optional) – Required when \`confirm\` is true; the token from the preview step.
- \`tag\` (optional) – Preview tag label. Defaults to \`${DEFAULT_PENDING_DELETION_TAG}\`.
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
      { workbookId, confirm, confirmationToken, tag },
      extra,
    ): Promise<CallToolResult> => {
      return await deleteWorkbookTool.logAndExecute<string>({
        extra,
        args: { workbookId, confirm, confirmationToken, tag },
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

              // Gate the destructive path on the confirmation token BEFORE any read or write, so a
              // missing/mismatched token is rejected with zero side effects. This forces a
              // deliberate two-step delete; it does not prove a preview ran (the token is a
              // deterministic hash of caller-known inputs — see computeConfirmationToken).
              if (confirm && confirmationToken !== expectedToken) {
                return new ArgsValidationError(
                  'Deletion requires the confirmationToken returned by the preview step. ' +
                    'Run delete-workbook with confirm omitted (or false) for this workbookId first, ' +
                    'then call again with confirm: true and the confirmationToken from that response.',
                ).toErr();
              }

              // Honor the same tool-scoping rules the read tools enforce (e.g. get-workbook):
              // a workbook outside the configured bounded context cannot be tagged or deleted.
              // Runs before any read/write so a rejected call has zero side effects.
              const isWorkbookAllowedResult = await resourceAccessChecker.isWorkbookAllowed({
                workbookId,
                extra,
              });
              if (!isWorkbookAllowedResult.allowed) {
                return new WorkbookNotAllowedError(isWorkbookAllowedResult.message).toErr();
              }

              // Resolve identity in both phases so the response (preview AND the final delete
              // confirmation) always names the workbook, project, and owner for an auditable
              // record of exactly what was acted on. Reuse the workbook already fetched by the
              // access check when a project scope forced it, otherwise fetch it now.
              const workbook =
                isWorkbookAllowedResult.content ??
                (await restApi.workbooksMethods.getWorkbook({ workbookId, siteId }));
              const ownerEmail = await resolveOwnerEmail(
                restApi,
                siteId,
                workbook.owner?.id,
                'delete-workbook',
              );
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
              // Treat undefined, empty, and whitespace-only tags as "use the default" so a
              // blank label never gets applied to the workbook.
              const pendingTag = tag?.trim() ? tag : DEFAULT_PENDING_DELETION_TAG;
              await restApi.workbooksMethods.addTagsToWorkbook({
                workbookId,
                siteId,
                tagLabels: [pendingTag],
              });

              return new Ok(
                `Preview — workbook '${workbook.name}' (id ${workbookId}) in '${projectName}', ${ownerText}. ` +
                  `It has been tagged '${pendingTag}' (reversible). ` +
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
