import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Result } from 'ts-results-es';
import { z } from 'zod';

import { apiVersionAtLeast, ApiVersionFloor } from '../../../desktop/externalApi/apiVersion.js';
import { ExecuteCommandError } from '../../../desktop/externalApi/executorTypes.js';
import { ExternalApiToolExecutor } from '../../../desktop/externalApi/externalApiToolExecutor.js';
import { endpointNotInThisBuild } from '../../../desktop/externalApi/toolUtils.js';
import { ImageExportQuery, ImageResult, SheetKind } from '../../../desktop/externalApi/types.js';
import { runExternalApiReadTool } from '../../../desktop/wrappers/readHarness.js';
import { McpToolError } from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { imageFilePathParam, sessionParam } from '../params.js';
import { DesktopTool } from '../tool.js';
import {
  buildSheetImageToolResult,
  exportSheetImageWithDeadline,
  resolveImageExportQuery,
} from './exportSheetImageResult.js';
import { resolveSheetRef } from './resolveSheetRef.js';

const paramsSchema = {
  session: sessionParam(),
  sheetId: z.string().min(1).describe('Id of the sheet to render. A unique sheet name also works.'),
  kind: z
    .enum(['worksheet', 'dashboard', 'storyboard'])
    .describe('Which kind of sheet sheetId is.'),
  filePath: imageFilePathParam(),
  mimeType: z
    .enum(['image/png', 'image/svg+xml'])
    .optional()
    .describe('Image MIME type to render. Defaults to image/png.'),
};
const title = 'Export Sheet Image';

const STORYBOARD_MIN_API_VERSION: ApiVersionFloor = '0.2.7';

const LABEL: Record<SheetKind, string> = {
  worksheet: 'Worksheet',
  dashboard: 'Dashboard',
  storyboard: 'Storyboard',
};

export const exportSheetImageTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const exportSheetImage = new DesktopTool({
    server,
    name: 'export-sheet-image',
    title,
    description:
      'Render one worksheet, dashboard or storyboard as an image. ' +
      'A storyboard renders only its active story point; other points cannot be selected.',
    paramsSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true, // a caller-supplied filePath can overwrite an existing file at that path
      idempotentHint: false,
      openWorldHint: false,
    },
    callback: async (
      { session, sheetId, kind, filePath, mimeType },
      extra,
    ): Promise<CallToolResult> => {
      const { query } = resolveImageExportQuery({ filePath, mimeType });
      const label = LABEL[kind];
      const endpoint = `${kind} image`;
      return await exportSheetImage.logAndExecute<ImageResult>({
        extra,
        args: { session, sheetId, kind, filePath, mimeType },
        callback: async () =>
          await runExternalApiReadTool<ImageResult>({
            session,
            extra,
            callback: async (executor, signal, read) => {
              const apiVersion = executor.desktopApiVersion;
              if (
                kind === 'storyboard' &&
                apiVersion !== undefined &&
                !apiVersionAtLeast(apiVersion, STORYBOARD_MIN_API_VERSION)
              ) {
                return endpointNotInThisBuild(endpoint).toErr();
              }

              return await exportSheetImageWithDeadline({
                label,
                timeoutMs: extra.config.imageExportTimeoutMs,
                signal,
                exportImage: async (combined) => {
                  const byId = await exportByKind(executor, kind, sheetId, query, combined);
                  const readById = async (): Promise<Result<ImageResult, McpToolError>> =>
                    await read(endpoint, async () => await Promise.resolve(byId));
                  if (
                    byId.isOk() ||
                    byId.error.type !== 'command-failed' ||
                    byId.error.error?.code !== 'sheet-not-found'
                  ) {
                    return await readById();
                  }
                  const resolved = await resolveSheetRef({ session, sheet: sheetId, kind, extra });
                  if (resolved.isErr()) {
                    return resolved;
                  }
                  const { id } = resolved.value.ref;
                  if (id === sheetId) {
                    return await readById();
                  }
                  return await read(
                    endpoint,
                    async (activeExecutor) =>
                      await exportByKind(activeExecutor, kind, id, query, combined),
                  );
                },
              });
            },
          }),
        getSuccessResult: (image) =>
          buildSheetImageToolResult({
            tool: 'export-sheet-image',
            label,
            cachePrefix: `${kind}-image`,
            image,
            config: extra.config,
          }),
      });
    },
  });

  return exportSheetImage;
};

async function exportByKind(
  executor: ExternalApiToolExecutor,
  kind: SheetKind,
  id: string,
  query: ImageExportQuery,
  signal: AbortSignal,
): Promise<Result<ImageResult, ExecuteCommandError>> {
  switch (kind) {
    case 'worksheet':
      return await executor.exportWorksheetImage(id, query, signal);
    case 'dashboard':
      return await executor.exportDashboardImage(id, query, signal);
    case 'storyboard':
      return await executor.exportStoryboardImage(id, query, signal);
  }
}
