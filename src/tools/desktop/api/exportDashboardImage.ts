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
  dashboardName: artifactNameParam('dashboard').optional(),
  dashboard: deprecatedArtifactAliasParam('dashboard'),
  filePath: z
    .string()
    .optional()
    .describe('Absolute path to save the image to. Omit to get the image inline.'),
  mimeType: z
    .enum(['image/png', 'image/svg+xml'])
    .optional()
    .describe('Image MIME type to render. Defaults to image/png.'),
};
const title = 'Export Dashboard Image';

export const exportDashboardImageTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const exportDashboardImage = new DesktopTool({
    server,
    name: 'export-dashboard-image',
    title,
    description: 'Render one dashboard as an image.',
    paramsSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true, // a caller-supplied filePath can overwrite an existing file at that path
      idempotentHint: false,
      openWorldHint: false,
    },
    callback: async (
      { session, dashboardName, dashboard, filePath, mimeType },
      extra,
    ): Promise<CallToolResult> => {
      const { query } = resolveImageExportQuery({ filePath, mimeType });
      return await exportDashboardImage.logAndExecute<ImageResult>({
        extra,
        args: { session, dashboardName, dashboard, filePath, mimeType },
        callback: async () => {
          const nameResult = resolveArtifactNameArg('dashboard', dashboardName, dashboard);
          if (nameResult.isErr()) {
            return nameResult;
          }
          const resolvedDashboardName = nameResult.value;
          return await runExternalApiReadTool<ImageResult>({
            session,
            extra,
            callback: async (_executor, _signal, read) => {
              const listResult = await read(
                'dashboard list',
                async (executor, signal) => await executor.listDashboards(signal),
              );
              if (listResult.isErr()) {
                return listResult;
              }

              const dashboardResult = resolveItemByNameOrId(
                'Dashboard',
                resolvedDashboardName,
                listResult.value.dashboards ?? [],
              );
              if (dashboardResult.isErr()) {
                return dashboardResult.error.toErr();
              }

              return await exportSheetImageWithDeadline({
                label: 'Dashboard',
                endpoint: 'dashboard image',
                timeoutMs: extra.config.imageExportTimeoutMs,
                signal: _signal,
                read,
                doExport: (executor, combined) =>
                  executor.exportDashboardImage(dashboardResult.value.id, query, combined),
              });
            },
          });
        },
        getSuccessResult: (image) =>
          buildSheetImageToolResult({
            tool: 'export-dashboard-image',
            label: 'Dashboard',
            cachePrefix: 'dashboard-image',
            image,
            config: extra.config,
          }),
      });
    },
  });

  return exportDashboardImage;
};
