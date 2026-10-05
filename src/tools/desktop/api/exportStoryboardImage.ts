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
  storyboardName: artifactNameParam('storyboard').optional(),
  storyboard: deprecatedArtifactAliasParam('storyboard'),
  filePath: z
    .string()
    .optional()
    .describe('Absolute path to save the image to. Omit to get the image inline.'),
  mimeType: z
    .enum(['image/png', 'image/svg+xml'])
    .optional()
    .describe('Image MIME type to render. Defaults to image/png.'),
};
const title = 'Export Storyboard Image';

export const exportStoryboardImageTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const exportStoryboardImage = new DesktopTool({
    server,
    name: 'export-storyboard-image',
    minApiVersion: '0.2.7',
    title,
    description:
      "Render a storyboard's active story point as an image. Only the active point is rendered; other story points are not included and cannot be selected.",
    paramsSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true, // a caller-supplied filePath can overwrite an existing file at that path
      idempotentHint: false,
      openWorldHint: false,
    },
    callback: async (
      { session, storyboardName, storyboard, filePath, mimeType },
      extra,
    ): Promise<CallToolResult> => {
      const { query } = resolveImageExportQuery({ filePath, mimeType });
      return await exportStoryboardImage.logAndExecute<ImageResult>({
        extra,
        args: { session, storyboardName, storyboard, filePath, mimeType },
        callback: async () => {
          const nameResult = resolveArtifactNameArg('storyboard', storyboardName, storyboard);
          if (nameResult.isErr()) {
            return nameResult;
          }
          const resolvedStoryboardName = nameResult.value;
          return await runExternalApiReadTool<ImageResult>({
            session,
            extra,
            callback: async (_executor, _signal, read) => {
              const listResult = await read(
                'storyboard list',
                async (executor, signal) => await executor.listStoryboards(signal),
              );
              if (listResult.isErr()) {
                return listResult;
              }

              const storyboardResult = resolveItemByNameOrId(
                'Storyboard',
                resolvedStoryboardName,
                listResult.value.storyboards ?? [],
              );
              if (storyboardResult.isErr()) {
                return storyboardResult.error.toErr();
              }

              return await exportSheetImageWithDeadline({
                label: 'Storyboard',
                endpoint: 'storyboard image',
                timeoutMs: extra.config.imageExportTimeoutMs,
                signal: _signal,
                read,
                doExport: (executor, combined) =>
                  executor.exportStoryboardImage(storyboardResult.value.id, query, combined),
              });
            },
          });
        },
        getSuccessResult: (image) =>
          buildSheetImageToolResult({
            tool: 'export-storyboard-image',
            label: 'Storyboard',
            cachePrefix: 'storyboard-image',
            image,
            config: extra.config,
          }),
      });
    },
  });

  return exportStoryboardImage;
};
