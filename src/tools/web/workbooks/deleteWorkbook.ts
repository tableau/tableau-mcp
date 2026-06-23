import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { getConfig } from '../../../config.js';
import {
  AdminOnlyError,
  PreviewNotRunError,
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

const paramsSchema = {
  workbookId: z.string().describe('The LUID of the workbook to delete.'),
  confirm: z
    .boolean()
    .optional()
    .describe(
      'When omitted or false, runs a non-destructive preview: tags the workbook as pending ' +
        'deletion and reports what would be deleted. When true, permanently deletes the workbook — ' +
        'but only if it is currently tagged as pending deletion by a prior preview call (the server ' +
        're-fetches and verifies the tag). Deleted workbooks are recoverable from the Tableau recycle ' +
        'bin for a limited time.',
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
   \`${DEFAULT_PENDING_DELETION_TAG}\`), reports the workbook name, project, and owner, and does
   **not** delete anything.
2. **Delete (\`confirm: true\`):** permanently removes the workbook. Before deleting, the server
   re-fetches the workbook and verifies it is tagged as pending deletion (the tag applied in step 1).
   If the tag is absent the deletion is rejected — this is a server-authoritative gate that genuinely
   requires the preview phase to have run; it cannot be bypassed by computing a token, because the
   caller has no way to set the tag other than by previewing. On Tableau Cloud the workbook is moved
   to the recycle bin and can be restored for a limited time before permanent removal (see
   ${RECYCLE_BIN_DOC_URL}).

**Required human confirmation:** After preview, present the workbook (name, project, owner) to the
user and get explicit approval before calling again with \`confirm: true\`. Do not auto-confirm — get
the user's explicit approval first.

**Parameters:**
- \`workbookId\` (required) – The LUID of the workbook. Obtain it from \`list-workbooks\`.
- \`confirm\` (optional) – Set \`true\` to perform the deletion (requires the pending-deletion tag from
  a prior preview). Defaults to preview.
- \`tag\` (optional) – Preview tag label. Defaults to \`${DEFAULT_PENDING_DELETION_TAG}\`. If you
  previewed with a custom tag, pass the same value when confirming.
`.trim(),
    paramsSchema,
    annotations: {
      title: 'Delete Workbook',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    callback: async ({ workbookId, confirm, tag }, extra): Promise<CallToolResult> => {
      return await deleteWorkbookTool.logAndExecute<string>({
        extra,
        args: { workbookId, confirm, tag },
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

              // Treat undefined, empty, and whitespace-only tags as "use the default" so a blank
              // label never gets applied (preview) or verified against (confirm).
              const pendingTag = tag?.trim() ? tag : DEFAULT_PENDING_DELETION_TAG;

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

              if (confirm) {
                // Server-authoritative HITL gate: re-fetch the workbook LIVE and verify it carries the
                // pending-deletion tag set by a prior preview call. The tag is server-side state the
                // caller cannot fabricate, so its presence is genuine proof the preview ran — unlike a
                // caller-computable confirmation token, this gate cannot be bypassed. We query fresh
                // here (not the access-check's cached content) so the check reflects the current server
                // state at delete time. Rejected with zero destructive side effects.
                const workbook = await restApi.workbooksMethods.getWorkbook({ workbookId, siteId });
                const isPendingDeletion = workbook.tags?.tag?.some((t) => t.label === pendingTag);
                if (!isPendingDeletion) {
                  return new PreviewNotRunError(
                    `Deletion blocked: workbook ${workbookId} is not tagged '${pendingTag}' as pending ` +
                      'deletion. Run delete-workbook with confirm omitted (or false) for this workbookId ' +
                      'first to preview and tag it, then call again with confirm: true. This gate verifies ' +
                      'server-side state and cannot be bypassed by computing a token.',
                  ).toErr();
                }

                const ownerEmail = await resolveOwnerEmail(
                  restApi,
                  siteId,
                  workbook.owner?.id,
                  'delete-workbook',
                );
                const projectName = workbook.project?.name ?? 'unknown project';
                const ownerText = ownerEmail ? `owner ${ownerEmail}` : 'owner unknown';

                await restApi.workbooksMethods.deleteWorkbook({ workbookId, siteId });
                return new Ok(
                  `Deleted workbook '${workbook.name}' (id ${workbookId}) in '${projectName}', ${ownerText}. ` +
                    `It can be restored from the Tableau recycle bin (${RECYCLE_BIN_DOC_URL}) for a ` +
                    'limited time before permanent removal.',
                );
              }

              // Preview phase: tag as pending deletion and report. No deletion.
              // Resolve identity so the response names the workbook, project, and owner for an
              // auditable record of exactly what was acted on. Reuse the workbook already fetched by
              // the access check when a project scope forced it, otherwise fetch it now.
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
                  'Once approved, call again with confirm: true (the server will verify this ' +
                  `'${pendingTag}' tag before deleting). ` +
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
