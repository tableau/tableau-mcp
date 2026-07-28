import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { ImageResult } from '../../../desktop/externalApi/types.js';
import { ImageExportTimeoutError } from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { runExternalApiReadTool } from '../externalApiReadHarness.js';
import { DesktopTool } from '../tool.js';
import { buildSheetImageToolResult, resolveImageExportQuery } from './exportSheetImageResult.js';
import { resolveItemByNameOrId } from './externalApiToolUtils.js';

const paramsSchema = {
  session: z.string().optional().describe('Session ID; optional if pinned or unique.'),
  dashboard: z.string().describe('Dashboard name/id.'),
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
      title,
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
    callback: async (
      { session, dashboard, filePath, mimeType },
      extra,
    ): Promise<CallToolResult> => {
      const { query, effectiveMimeType } = resolveImageExportQuery({ filePath, mimeType });
      return await exportDashboardImage.logAndExecute<ImageResult>({
        extra,
        args: { session, dashboard, filePath, mimeType },
        callback: async () => {
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
                dashboard,
                listResult.value.dashboards ?? [],
              );
              if (dashboardResult.isErr()) {
                return dashboardResult.error.toErr();
              }

              // Scope a deadline to the image call only (the list call rides extra.signal). The
              // first render after Desktop launches can hang forever behind a modal dialog; this
              // converts that into a reportable timeout instead of an unbounded wait. The harness
              // read() always passes extra.signal into the closure, so pass `combined` explicitly.
              const timeoutSignal = AbortSignal.timeout(extra.config.imageExportTimeoutMs);
              const combined = AbortSignal.any([_signal, timeoutSignal]);
              const imageResult = await read(
                'dashboard image',
                async (executor) =>
                  await executor.exportDashboardImage(dashboardResult.value.id, query, combined),
              );
              if (imageResult.isErr() && timeoutSignal.aborted && !_signal.aborted) {
                return new ImageExportTimeoutError(
                  'Dashboard',
                  extra.config.imageExportTimeoutMs,
                ).toErr();
              }
              return imageResult;
            },
          });
        },
        getSuccessResult: (image) =>
          buildSheetImageToolResult({
            tool: 'export-dashboard-image',
            label: 'Dashboard',
            cachePrefix: 'dashboard-image',
            mimeType: effectiveMimeType,
            image,
            config: extra.config,
          }),
      });
    },
  });

  return exportDashboardImage;
};
