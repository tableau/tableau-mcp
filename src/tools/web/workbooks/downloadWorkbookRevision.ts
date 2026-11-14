import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { WorkbookNotAllowedError } from '../../../errors/mcpToolError.js';
import { isAuthoringAllowedForClient } from '../../../features/authoringAccess.js';
import { useRestApi } from '../../../restApiInstance.js';
import { luidSchema } from '../../../sdks/routeSafety/ids.js';
import { SiteRole } from '../../../sdks/tableau/types/user.js';
import { revisionNumberSchema } from '../../../sdks/tableau/types/workbookRevision.js';
import { WebMcpServer } from '../../../server.web.js';
import { Provider } from '../../../utils/provider.js';
import { resourceAccessChecker } from '../resourceAccessChecker.js';
import { WebTool } from '../tool.js';
import {
  buildWorkbookToolResult,
  WorkbookToolResult,
  workbookToolResultToCallToolResult,
} from './workbookToolResult.js';

const paramsSchema = {
  workbookId: luidSchema.describe('The LUID of the workbook to download a revision of.'),
  revisionNumber: revisionNumberSchema.describe(
    'The positive revision number from list-workbook-revisions. The current or deleted revision cannot be downloaded here.',
  ),
  includeExtract: z
    .boolean()
    .optional()
    .describe('Whether to include extracts in the workbook package.'),
};

/** Downloads only the explicitly requested historical revision, without restoring it. */
export const getDownloadWorkbookRevisionTool = (
  server: WebMcpServer,
): WebTool<typeof paramsSchema> => {
  const tool = new WebTool({
    server,
    name: 'download-workbook-revision',
    minRequiredRole: SiteRole.EXPLORER_CAN_PUBLISH,
    description:
      'Downloads a specific past workbook revision as a TWB or TWBX file. Discover revision numbers with list-workbook-revisions. Requires site revision history and permission to download revisions. Use download-workbook for the current revision. This does not restore or publish the revision.',
    paramsSchema,
    disabled: new Provider(async () => !(await isAuthoringAllowedForClient(server.clientId))),
    annotations: {
      title: 'Download Workbook Revision',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    callback: async (
      { workbookId, revisionNumber, includeExtract },
      extra,
    ): Promise<CallToolResult> =>
      await tool.logAndExecute<WorkbookToolResult>({
        extra,
        args: { workbookId, revisionNumber, includeExtract },
        callback: async () => {
          const allowed = await resourceAccessChecker.isWorkbookAllowed({ workbookId, extra });
          if (!allowed.allowed) return new WorkbookNotAllowedError(allowed.message).toErr();
          const file = await useRestApi({
            ...extra,
            jwtScopes: tool.requiredApiScopes,
            callback: async (restApi) =>
              await restApi.workbooksMethods.downloadWorkbookRevision({
                siteId: restApi.siteId,
                workbookId,
                revisionNumber,
                includeExtract,
              }),
          });
          const rawMimeType = (file.contentType ?? 'application/octet-stream')
            .split(';')[0]
            .trim()
            .toLowerCase();
          const mimeType = rawMimeType === 'text/xml' ? 'application/xml' : rawMimeType;
          const extension = mimeType.split(';')[0] === 'application/xml' ? 'twb' : 'twbx';
          return new Ok(
            await buildWorkbookToolResult({
              content: file.content,
              mimeType,
              filename:
                file.filename ?? `workbook-${workbookId}-revision-${revisionNumber}.${extension}`,
              resourceId: workbookId,
              config: extra.config,
              toolName: tool.name,
              keyPrefixSegment: 'workbook-revisions/',
            }),
          );
        },
        constrainSuccessResult: (result) => ({ type: 'success', result }),
        getSuccessResult: workbookToolResultToCallToolResult,
      }),
  });
  return tool;
};
