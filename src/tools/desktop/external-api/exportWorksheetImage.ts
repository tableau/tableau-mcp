import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { ImageResult } from '../../../desktop/externalApi/types.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { runExternalApiReadTool } from '../externalApiReadHarness.js';
import { DesktopTool } from '../tool.js';
import { buildSheetImageToolResult, resolveImageExportQuery } from './exportSheetImageResult.js';
import { resolveItemByNameOrId } from './externalApiToolUtils.js';

const paramsSchema = {
  session: z.string().optional().describe('Session ID; optional if pinned or unique.'),
  worksheet: z.string().describe('Worksheet name/id.'),
  filePath: z
    .string()
    .optional()
    .describe('Absolute path to save the image to. Omit to get the image inline.'),
  mimeType: z
    .enum(['image/png', 'image/svg+xml'])
    .optional()
    .describe('Image MIME type to render. Defaults to image/png.'),
};
const title = 'Export Worksheet Image';

export const exportWorksheetImageTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const exportWorksheetImage = new DesktopTool({
    server,
    name: 'export-worksheet-image',
    title,
    description: 'Render one worksheet as an image.',
    paramsSchema,
    annotations: {
      title,
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    callback: async (
      { session, worksheet, filePath, mimeType },
      extra,
    ): Promise<CallToolResult> => {
      const { query, effectiveMimeType } = resolveImageExportQuery({ filePath, mimeType });
      return await exportWorksheetImage.logAndExecute<ImageResult>({
        extra,
        args: { session, worksheet, filePath, mimeType },
        callback: async () => {
          return await runExternalApiReadTool<ImageResult>({
            session,
            extra,
            callback: async (_executor, _signal, read) => {
              const listResult = await read(
                'worksheet list',
                async (executor, signal) => await executor.listWorksheets(signal),
              );
              if (listResult.isErr()) {
                return listResult;
              }

              const worksheetResult = resolveItemByNameOrId(
                'Worksheet',
                worksheet,
                listResult.value.worksheets ?? [],
              );
              if (worksheetResult.isErr()) {
                return worksheetResult.error.toErr();
              }

              return await read(
                'worksheet image',
                async (executor, signal) =>
                  await executor.exportWorksheetImage(worksheetResult.value.id, query, signal),
              );
            },
          });
        },
        getSuccessResult: (image) =>
          buildSheetImageToolResult({
            tool: 'export-worksheet-image',
            label: 'Worksheet',
            cachePrefix: 'worksheet-image',
            mimeType: effectiveMimeType,
            image,
            config: extra.config,
          }),
      });
    },
  });

  return exportWorksheetImage;
};
