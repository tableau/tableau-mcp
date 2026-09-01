import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { WorkbookNotAllowedError } from '../../../errors/mcpToolError.js';
import { getFeatureGate } from '../../../features/init.js';
import { useRestApi } from '../../../restApiInstance.js';
import { DownloadWorkbookResult } from '../../../sdks/tableau/types/downloadWorkbookResult.js';
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
  workbookId: z.string(),
  includeExtract: z
    .boolean()
    .optional()
    .describe('Whether to include workbook extracts in the returned workbook package.'),
};

export const getDownloadWorkbookTool = (server: WebMcpServer): WebTool<typeof paramsSchema> => {
  const downloadWorkbookTool = new WebTool({
    server,
    name: 'download-workbook',
    description: [
      'Downloads workbook content as a TWB (application/xml) or TWBX (application/octet-stream) file.',
      'The returned file metadata includes Tableau-provided content type and filename when available.',
      'If the user asks to open the workbook file locally, derive the full Tableau Desktop application path instead of assuming it is named exactly "Tableau Desktop".',
      'If multiple Tableau Desktop versions are installed, select the most recent version by comparing version numbers in the application filename/path.',
    ].join(' '),
    paramsSchema,
    annotations: {
      title: 'Download Workbook',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    disabled: new Provider(
      async () => !(await getFeatureGate().isFeatureEnabled('authoring-tools')),
    ),
    callback: async ({ workbookId, includeExtract }, extra): Promise<CallToolResult> => {
      return await downloadWorkbookTool.logAndExecute<WorkbookToolResult>({
        extra,
        args: { workbookId, includeExtract },
        callback: async () => {
          const isWorkbookAllowedResult = await resourceAccessChecker.isWorkbookAllowed({
            workbookId,
            extra,
          });
          if (!isWorkbookAllowedResult.allowed) {
            return new WorkbookNotAllowedError(isWorkbookAllowedResult.message).toErr();
          }

          const workbook: DownloadWorkbookResult = await useRestApi({
            ...extra,
            jwtScopes: downloadWorkbookTool.requiredApiScopes,
            callback: async (restApi) =>
              await restApi.workbooksMethods.downloadWorkbook({
                siteId: restApi.siteId,
                workbookId,
                includeExtract,
              }),
          });
          const mimeType = workbook.contentType ?? 'application/octet-stream';
          const extension = mimeType === 'application/xml' ? 'twb' : 'twbx';
          const filename = workbook.filename ?? `workbook-${workbookId}.${extension}`;

          return new Ok(
            await buildWorkbookToolResult({
              content: workbook.content,
              mimeType,
              filename,
              resourceId: workbookId,
              toolName: downloadWorkbookTool.name,
              keyPrefixSegment: 'workbook-files/',
            }),
          );
        },
        constrainSuccessResult: (result) => ({
          type: 'success',
          result,
        }),
        getSuccessResult: (result) => workbookToolResultToCallToolResult(result),
      });
    },
  });

  return downloadWorkbookTool;
};
