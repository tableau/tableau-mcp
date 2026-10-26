import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { existsSync } from 'fs';
import { join } from 'path';
import { z } from 'zod';

import { datappNameSchema } from '../../../../dataApps/dataAppName.js';
import {
  PreparedDesktopDataApp,
  prepareDesktopDataApp,
} from '../../../../dataApps/prepareDesktopDataApp.js';
import { DesktopCache } from '../../../../desktop/cache.js';
import { runExternalApiTool } from '../../../../desktop/wrappers/readHarness.js';
import { McpToolError } from '../../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../../server.desktop.js';
import { getDirname } from '../../../../utils/getDirname.js';
import { sessionParam } from '../../params.js';
import { DesktopTool } from '../../tool.js';

const paramsSchema = {
  session: sessionParam(),
  datappName: z.string().min(1).max(100).describe('Display name for the new data app.'),
  datasourceId: z.string().min(1).describe('External API datasource id.'),
};

export function resolveTemplatePackageDir(): string | undefined {
  const packageTail = join('templates', 'Data App Name', 'Packages', 'TODO-MANIFEST-ID');
  const candidates = [
    join(process.cwd(), 'src', packageTail),
    join(getDirname(), '..', '..', '..', '..', packageTail),
    join(getDirname(), '..', '..', packageTail),
    join(process.cwd(), 'build', packageTail),
  ];
  return candidates.find((candidate) => existsSync(join(candidate, 'manifest.json')));
}

export const getScaffoldDataAppTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const tool = new DesktopTool({
    server,
    name: 'scaffold-data-app',
    title: 'Scaffold a Desktop data app',
    description:
      'Prepares a worksheet data app and does not add a sheet. Returns packageId, sourceDir, worksheetFile, datasourceId, and worksheetName.',
    paramsSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    callback: async ({ session, datappName, datasourceId }, extra): Promise<CallToolResult> => {
      return await tool.logAndExecute<PreparedDesktopDataApp>({
        extra,
        args: { session, datappName, datasourceId },
        callback: async () => {
          const name = datappNameSchema.safeParse(datappName);
          if (!name.success) {
            return new McpToolError({
              type: 'invalid-data-app-name',
              message: name.error.issues.map((issue) => issue.message).join(' '),
              statusCode: 400,
            }).toErr();
          }
          const workspaceRoot = extra.config.dataAppWorkspaceDir;
          if (!workspaceRoot) {
            return new McpToolError({
              type: 'data-app-workspace-unconfigured',
              message:
                'Set TABLEAU_DATA_APP_WORKSPACE_DIR to an absolute directory before scaffolding a Desktop data app.',
              statusCode: 400,
            }).toErr();
          }
          const templatePackageDir = resolveTemplatePackageDir();
          if (!templatePackageDir) {
            return new McpToolError({
              type: 'data-app-template-missing',
              message:
                'The data app template package is not in this build. Rebuild so src/templates/Data App Name is available.',
              statusCode: 500,
            }).toErr();
          }
          const listed = await runExternalApiTool({
            session,
            extra,
            callback: async (_executor, _signal, call) =>
              await call(
                'workbook datasources',
                async (executor, signal) => await executor.listWorkbookDatasources(signal),
              ),
          });
          if (listed.isErr()) {
            return listed;
          }
          const worksheetFile = new DesktopCache().getCacheFilePath({
            prefix: 'data-app-worksheet',
            extension: 'xml',
          });
          return await prepareDesktopDataApp({
            workspaceRoot,
            worksheetFile,
            templatePackageDir,
            datappName,
            datasourceId,
            datasources: listed.value.datasources ?? [],
          });
        },
      });
    },
  });
  return tool;
};
