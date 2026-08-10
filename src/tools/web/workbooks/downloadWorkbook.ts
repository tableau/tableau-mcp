import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { WorkbookNotAllowedError } from '../../../errors/mcpToolError.js';
import { useRestApi } from '../../../restApiInstance.js';
import { WebMcpServer } from '../../../server.web.js';
import { resourceAccessChecker } from '../resourceAccessChecker.js';
import { WebTool } from '../tool.js';
import { DownloadedWorkbookFile, persistDownloadedWorkbook } from './downloadedWorkbookFile.js';

const paramsSchema = {
  workbookId: z.string().min(1).describe('The LUID of the published workbook to download.'),
  includeExtract: z
    .boolean()
    .optional()
    .describe(
      'Whether to include workbook extracts. Defaults to false to reduce download size for authoring workflows.',
    ),
};

export type DownloadWorkbookResult = DownloadedWorkbookFile & {
  includeExtract: boolean;
};

export const getDownloadWorkbookTool = (server: WebMcpServer): WebTool<typeof paramsSchema> => {
  const tool = new WebTool({
    server,
    name: 'download-workbook',
    description:
      'Downloads a published Tableau workbook to a private temporary file accessible to the MCP server. Returns the absolute local path, file type, and size without placing workbook bytes in model context. The result may be a TWB or TWBX; only a TWB path can be passed directly to start-web-authoring-session. The caller must have ExportXml permission for the workbook.',
    paramsSchema,
    annotations: {
      title: 'Download Workbook',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    callback: async ({ workbookId, includeExtract }, extra): Promise<CallToolResult> => {
      const resolvedIncludeExtract = includeExtract ?? false;

      return await tool.logAndExecute<DownloadWorkbookResult>({
        extra,
        args: { workbookId, includeExtract: resolvedIncludeExtract },
        callback: async () => {
          const isWorkbookAllowedResult = await resourceAccessChecker.isWorkbookAllowed({
            workbookId,
            extra,
          });

          if (!isWorkbookAllowedResult.allowed) {
            return new WorkbookNotAllowedError(isWorkbookAllowedResult.message).toErr();
          }

          const downloadedFile = await useRestApi({
            ...extra,
            jwtScopes: tool.requiredApiScopes,
            callback: async (restApi) => {
              const downloadedWorkbook = await restApi.workbooksMethods.downloadWorkbook({
                siteId: restApi.siteId,
                workbookId,
                includeExtract: resolvedIncludeExtract,
              });

              // Consume the stream before useRestApi releases its authentication context.
              return await persistDownloadedWorkbook(downloadedWorkbook);
            },
          });

          return new Ok({
            ...downloadedFile,
            includeExtract: resolvedIncludeExtract,
          });
        },
        constrainSuccessResult: (result) => ({ type: 'success', result }),
        getSuccessResult: (result) => ({
          isError: false,
          structuredContent: result,
          content: [{ type: 'text', text: JSON.stringify(result) }],
        }),
      });
    },
  });

  return tool;
};
