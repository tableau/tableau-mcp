import { Ok, Result } from 'ts-results-es';
import { z } from 'zod';

import { McpToolError, WorkbookNotAllowedError } from '../../../errors/mcpToolError.js';
import { getFeatureGate } from '../../../features/init.js';
import { useRestApi } from '../../../restApiInstance.js';
import { RouteSafetyError } from '../../../sdks/routeSafety/core.js';
import { luidSchema } from '../../../sdks/routeSafety/ids.js';
import { RestApi } from '../../../sdks/tableau/restApi.js';
import { SiteRole } from '../../../sdks/tableau/types/user.js';
import { revisionNumberSchema } from '../../../sdks/tableau/types/workbookRevision.js';
import { WebMcpServer } from '../../../server.web.js';
import { getHttpStatus } from '../../../utils/getHttpStatus.js';
import { Provider } from '../../../utils/provider.js';
import { resourceAccessChecker } from '../resourceAccessChecker.js';
import { WebTool } from '../tool.js';

const MIN_REST_VERSION = '3.30';

const paramsSchema = {
  workbookId: luidSchema.describe('The LUID of the workbook whose revision notes to replace.'),
  revisionNumber: revisionNumberSchema.describe('The exact positive workbook revision number.'),
  notes: z.string().describe('The full replacement revision notes. Existing notes are overwritten.'),
};

type UpdateWorkbookRevisionNotesResult = {
  workbookId: string;
  revisionNumber: number;
  updated: true;
};

export const getUpdateWorkbookRevisionNotesTool = (
  server: WebMcpServer,
): WebTool<typeof paramsSchema> => {
  const tool = new WebTool({
    server,
    name: 'update-workbook-revision-notes',
    minRequiredRole: SiteRole.EXPLORER_CAN_PUBLISH,
    description:
      'Replaces the notes for one existing workbook revision, not the workbook contents. ' +
      'Requires Tableau REST API 3.30 or later and revision history enabled on Tableau Server. ' +
      'Use list-workbook-revisions to identify the revision. Confirm the exact workbook, revision, and full replacement text with the user before calling.',
    paramsSchema,
    annotations: {
      title: 'Update Workbook Revision Notes',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: true,
    },
    disabled: new Provider(async () => !(await getFeatureGate().isFeatureEnabled('data-apps'))),
    callback: async ({ workbookId, revisionNumber, notes }, extra) =>
      await tool.logAndExecute<UpdateWorkbookRevisionNotesResult>({
        extra,
        args: { workbookId, revisionNumber, notes: '<redacted>' },
        callback: async () => {
          if (!RestApi.versionIsAtLeast(MIN_REST_VERSION)) {
            return new McpToolError({
              type: 'update-workbook-revision-notes-version-unsupported',
              statusCode: 400,
              message: `Update Workbook Revision Notes requires Tableau REST API version ${MIN_REST_VERSION} or later.`,
            }).toErr();
          }

          const allowed = await resourceAccessChecker.isWorkbookAllowed({ workbookId, extra });
          if (!allowed.allowed) {
            return new WorkbookNotAllowedError(allowed.message).toErr();
          }

          return await useRestApi<Result<UpdateWorkbookRevisionNotesResult, McpToolError>>({
            ...extra,
            jwtScopes: tool.requiredApiScopes,
            // The REST debug interceptor normally logs request bodies.
            disableLogging: true,
            callback: async (restApi) => {
              try {
                await restApi.workbooksMethods.updateWorkbookRevisionNotes({
                  siteId: restApi.siteId,
                  workbookId,
                  revisionNumber,
                  notes,
                });
              } catch (error) {
                if (error instanceof RouteSafetyError) throw error;
                // Axios or a response validation error can carry the request body. Do not expose it
                // to the outer tool logger or result. Preserve only the HTTP status when known.
                const status = error instanceof Error ? getHttpStatus(error) : '';
                const detail =
                  status === '403'
                    ? 'Check workbook and project permissions and site revision-history settings.'
                    : status === '404'
                      ? 'Check the workbook and revision number on this site.'
                      : 'Check the selected revision and the Tableau connection.';
                return new McpToolError({
                  type: 'workbook-revision-notes-update-failed',
                  statusCode: status ? Number(status) : 500,
                  message: `Tableau could not confirm the revision notes update. ${detail}`,
                }).toErr();
              }

              return new Ok<UpdateWorkbookRevisionNotesResult>({
                workbookId,
                revisionNumber,
                updated: true,
              });
            },
          });
        },
        constrainSuccessResult: (result) => ({ type: 'success', result }),
        getSuccessResult: (result) => ({
          isError: false,
          structuredContent: result,
          content: [{ type: 'text', text: JSON.stringify(result) }],
        }),
      }),
  });

  return tool;
};
