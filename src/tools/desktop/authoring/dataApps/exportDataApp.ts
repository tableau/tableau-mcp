import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { isAbsolute, join } from 'path';
import { z } from 'zod';

import {
  exportDataAppPackage,
  ExportedDataApp,
} from '../../../../dataApps/exportDataAppPackage.js';
import { runExternalApiTool } from '../../../../desktop/wrappers/readHarness.js';
import { McpToolError } from '../../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../../server.desktop.js';
import { sessionParam } from '../../params.js';
import { DesktopTool } from '../../tool.js';

const paramsSchema = {
  session: sessionParam(),
  sheet: z
    .string()
    .min(1)
    .describe('Stable sheet id or current sheet name of the data app to export.'),
};

export const getExportDataAppTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const tool = new DesktopTool({
    server,
    name: 'export-data-app',
    minApiVersion: '0.2.26',
    title: 'Export a data app package',
    description:
      'Writes a .tpkg for the selected sheet. Returns filePath, packageId, and version. Leaves the source files in place.',
    paramsSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    callback: async ({ session, sheet }, extra): Promise<CallToolResult> => {
      return await tool.logAndExecute<ExportedDataApp>({
        extra,
        args: { session, sheet },
        callback: async () => {
          const workspaceRoot = extra.config.dataAppWorkspaceDir;
          if (!workspaceRoot || !isAbsolute(workspaceRoot)) {
            return new McpToolError({
              type: 'data-app-workspace-unconfigured',
              message:
                'Set TABLEAU_DATA_APP_WORKSPACE_DIR to an absolute directory before exporting a data app.',
              statusCode: 400,
            }).toErr();
          }
          const listed = await runExternalApiTool({
            session,
            extra,
            callback: async (_executor, _signal, call) =>
              await call(
                'GET /v0/workbook/extensions',
                async (executor, signal) => await executor.listWorkbookExtensions(signal),
                { stableNotFoundMeansRouteMissing: true },
              ),
          });
          if (listed.isErr()) {
            return listed;
          }
          const matches = (listed.value.extensions ?? []).filter(
            (extension) => extension.sheet.id === sheet || extension.sheet.name === sheet,
          );
          if (matches.length !== 1) {
            return new McpToolError({
              type: 'data-app-sheet-not-selected',
              message: `Select one extension sheet. Requested "${sheet}". Matches: ${matches.length}.`,
              statusCode: 400,
            }).toErr();
          }
          const packagePath = matches[0].packagePath;
          if (!packagePath) {
            return new McpToolError({
              type: 'data-app-package-missing',
              message: 'The selected extension has no local package to export.',
              statusCode: 400,
            }).toErr();
          }
          return await exportDataAppPackage({
            packageDir: packagePath,
            exportsDir: join(workspaceRoot, 'exports'),
          });
        },
      });
    },
  });
  return tool;
};
