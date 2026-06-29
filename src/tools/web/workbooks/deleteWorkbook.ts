import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { getConfig } from '../../../config.js';
import { WorkbookNotAllowedError } from '../../../errors/mcpToolError.js';
import { useRestApi } from '../../../restApiInstance.js';
import { WebMcpServer } from '../../../server.web.js';
import { DEFAULT_PENDING_DELETION_TAG, TagEvidence } from '../_lib/evidence.js';
import { guardMutation, MutationTarget } from '../_lib/mutationGuard.js';
import { resourceAccessChecker } from '../resourceAccessChecker.js';
import { WebTool } from '../tool.js';
import { resolveOwnerEmail } from '../users/resolveOwnerEmail.js';

const RECYCLE_BIN_DOC_URL = 'https://help.tableau.com/current/pro/desktop/en-us/recycle_bin.htm';

// Re-exported for back-compat with callers that imported it from this module before it moved to
// the shared evidence module.
export { DEFAULT_PENDING_DELETION_TAG };

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
    .max(200)
    // Constrain to a safe tag character class. `tag` is interpolated into the preview-response text
    // the model reads back, so restricting it to alphanumerics/space/underscore/dash closes a
    // prompt-injection vector (e.g. a value with quotes/backticks trying to coerce auto-confirming).
    .regex(
      /^[A-Za-z0-9 _-]+$/,
      'tag must contain only letters, numbers, spaces, underscores, and dashes',
    )
    .optional()
    .describe(
      'Label applied to the workbook during the preview phase to mark it as pending deletion ' +
        '(reversible, visible in the Tableau UI). Letters, numbers, spaces, underscores, and dashes ' +
        `only. Defaults to '${DEFAULT_PENDING_DELETION_TAG}'.`,
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
              const siteId = restApi.siteId;

              // Treat undefined, empty, and whitespace-only tags as "use the default" so a blank
              // label never gets applied (preview) or verified against (confirm).
              const pendingTag = tag?.trim() || DEFAULT_PENDING_DELETION_TAG;

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

              // Resolve identity so both the audit record and the response name the workbook,
              // project, and owner. Reuse the workbook already fetched by the access check when a
              // project scope forced it, otherwise fetch it now.
              const resolveTarget = async (): Promise<MutationTarget> => {
                const workbook =
                  isWorkbookAllowedResult.content ??
                  (await restApi.workbooksMethods.getWorkbook({ workbookId, siteId }));
                const ownerEmail = await resolveOwnerEmail(
                  restApi,
                  siteId,
                  workbook.owner?.id,
                  'delete-workbook',
                );
                return {
                  id: workbookId,
                  name: workbook.name,
                  project: workbook.project?.name,
                  owner: ownerEmail ?? undefined,
                  kind: 'workbook',
                };
              };

              // Route the admin gate, tag-evidence gate, and authoritative audit through the shared
              // mutation guard. The guard re-fetches the workbook on confirm and verifies the
              // pending-deletion tag; a confirm without a prior preview is rejected server-side.
              const guardResult = await guardMutation({
                restApi,
                extra,
                tool: 'delete-workbook',
                action: 'delete',
                mode: 'preview-confirm',
                phase: confirm ? 'confirm' : 'preview',
                evidence: new TagEvidence({ tag: pendingTag, kind: 'workbook' }),
                resolveTarget,
              });
              if (guardResult.isErr()) {
                return guardResult.error.toErr();
              }
              const { target } = guardResult.value;
              const projectName = target.project ?? 'unknown project';
              const ownerText = target.owner ? `owner ${target.owner}` : 'owner unknown';

              if (confirm) {
                await restApi.workbooksMethods.deleteWorkbook({ workbookId, siteId });
                return new Ok(
                  `Deleted workbook '${target.name}' (id ${workbookId}) in '${projectName}', ${ownerText}. ` +
                    `It can be restored from the Tableau recycle bin (${RECYCLE_BIN_DOC_URL}) for a ` +
                    'limited time before permanent removal.',
                );
              }

              // Preview phase: the guard has tagged the workbook pending deletion. Report. No deletion.
              return new Ok(
                `Preview — workbook '${target.name}' (id ${workbookId}) in '${projectName}', ${ownerText}. ` +
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
