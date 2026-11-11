import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { resolveItemByNameOrId } from '../../../desktop/externalApi/toolUtils.js';
import { ImageResult } from '../../../desktop/externalApi/types.js';
import { runExternalApiReadTool } from '../../../desktop/wrappers/readHarness.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import {
  artifactNameParam,
  deprecatedArtifactAliasParam,
  resolveArtifactNameArg,
} from '../params.js';
import { DesktopTool } from '../tool.js';
import {
  buildSheetImageToolResult,
  exportSheetImageWithDeadline,
  resolveImageExportQuery,
} from './exportSheetImageResult.js';

const paramsSchema = {
  session: z.string().optional().describe('Session ID; optional if pinned or unique.'),
  worksheetName: artifactNameParam('worksheet').optional(),
  worksheet: deprecatedArtifactAliasParam('worksheet'),
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
      readOnlyHint: false,
      destructiveHint: true, // a caller-supplied filePath can overwrite an existing file at that path
      idempotentHint: false,
      openWorldHint: false,
    },
    callback: async (
      { session, worksheetName, worksheet, filePath, mimeType },
      extra,
    ): Promise<CallToolResult> => {
      const { query } = resolveImageExportQuery({ filePath, mimeType });
      return await exportWorksheetImage.logAndExecute<ImageResult>({
        extra,
        args: { session, worksheetName, worksheet, filePath, mimeType },
        callback: async () => {
          const nameResult = resolveArtifactNameArg('worksheet', worksheetName, worksheet);
          if (nameResult.isErr()) {
            return nameResult;
          }
          const resolvedWorksheetName = nameResult.value;
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
                resolvedWorksheetName,
                listResult.value.worksheets ?? [],
              );
              if (worksheetResult.isErr()) {
                return worksheetResult.error.toErr();
              }

              return await exportSheetImageWithDeadline({
                label: 'Worksheet',
                endpoint: 'worksheet image',
                timeoutMs: extra.config.imageExportTimeoutMs,
                signal: _signal,
                read,
                doExport: (executor, combined) =>
                  executor.exportWorksheetImage(worksheetResult.value.id, query, combined),
              });
            },
          });
        },
        getSuccessResult: (image) =>
          buildSheetImageToolResult({
            tool: 'export-worksheet-image',
            label: 'Worksheet',
            cachePrefix: 'worksheet-image',
            image,
            config: extra.config,
          }),
      });
    },
  });

  return exportWorksheetImage;
};
