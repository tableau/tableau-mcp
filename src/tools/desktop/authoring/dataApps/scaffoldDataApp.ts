import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { existsSync } from 'fs';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { z } from 'zod';

import { datappNameSchema } from '../../../../dataApps/dataAppName.js';
import { extractZip } from '../../../../dataApps/extractZip.js';
import {
  PreparedDesktopDataApp,
  prepareDesktopDataApp,
} from '../../../../dataApps/prepareDesktopDataApp.js';
import { DesktopCache } from '../../../../desktop/cache.js';
import { runExternalApiTool } from '../../../../desktop/wrappers/readHarness.js';
import { McpToolError } from '../../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../../server.desktop.js';
import { getDirname } from '../../../../utils/getDirname.js';
import {
  TEMPLATE_PACKAGE_DIRNAME,
  TEMPLATE_ROOT_DIRNAME,
} from '../../../web/scaffoldDataApp/templateIdentity.js';
import { resolveDataAppTemplateZipPath } from '../../../web/scaffoldDataApp/templateZip.js';
import { sessionParam } from '../../params.js';
import { DesktopTool } from '../../tool.js';

const paramsSchema = {
  session: sessionParam(),
  datappName: z.string().min(1).max(100).describe('Display name for the new data app.'),
  worksheetId: z
    .string()
    .min(1)
    .describe('Stable worksheet id from list-worksheets; stamped as <simple-id> for apply.'),
  datasourceId: z.string().min(1).describe('External API datasource id.'),
};

const extractedPackages = new Map<string, string>();

function explodedTemplatePackageDir(): string | undefined {
  const packageTail = join(
    'templates',
    TEMPLATE_ROOT_DIRNAME,
    'Packages',
    TEMPLATE_PACKAGE_DIRNAME,
  );
  const candidates = [
    join(process.cwd(), 'src', packageTail),
    join(getDirname(), '..', '..', '..', '..', packageTail),
    join(getDirname(), '..', '..', packageTail),
    join(process.cwd(), 'build', packageTail),
  ];
  return candidates.find((candidate) => existsSync(join(candidate, 'manifest.json')));
}

async function packageDirFromZip(zipPath: string): Promise<string | undefined> {
  const cached = extractedPackages.get(zipPath);
  if (cached) {
    return cached;
  }
  const root = await mkdtemp(join(tmpdir(), 'tableau-mcp-data-app-template-'));
  try {
    await extractZip(zipPath, root);
    const packageDir = join(root, TEMPLATE_ROOT_DIRNAME, 'Packages', TEMPLATE_PACKAGE_DIRNAME);
    if (!existsSync(join(packageDir, 'manifest.json'))) {
      await rm(root, { recursive: true, force: true });
      return undefined;
    }
    extractedPackages.set(zipPath, packageDir);
    return packageDir;
  } catch {
    await rm(root, { recursive: true, force: true });
    return undefined;
  }
}

// The build ships templates/data-app-template.zip (disk next to the bundle, or the
// SEA asset of the same name). The exploded source tree is only present in a checkout.
export async function resolveTemplatePackageDir(): Promise<string | undefined> {
  try {
    const zipPath = await resolveDataAppTemplateZipPath();
    if (zipPath) {
      const fromZip = await packageDirFromZip(zipPath);
      if (fromZip) {
        return fromZip;
      }
    }
  } catch {
    return explodedTemplatePackageDir();
  }
  return explodedTemplatePackageDir();
}

export async function resetTemplatePackageCache(): Promise<void> {
  const roots = new Set(
    [...extractedPackages.values()].map((packageDir) => join(packageDir, '..', '..', '..')),
  );
  extractedPackages.clear();
  await Promise.all([...roots].map((root) => rm(root, { recursive: true, force: true })));
}

export const getScaffoldDataAppTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const tool = new DesktopTool({
    server,
    name: 'scaffold-data-app',
    title: 'Scaffold a Desktop data app',
    description:
      'Prepares a data app package and worksheetFile for open sheet. Apply with apply-worksheet; pass worksheetId as worksheetName (stable id). Replaces that sheet; does not create or rename. Returns packageId, sourceDir, worksheetFile, datasourceId, worksheetId, worksheetName.',
    paramsSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    callback: async (
      { session, datappName, worksheetId, datasourceId },
      extra,
    ): Promise<CallToolResult> => {
      return await tool.logAndExecute<PreparedDesktopDataApp>({
        extra,
        args: { session, datappName, worksheetId, datasourceId },
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
          const templatePackageDir = await resolveTemplatePackageDir();
          if (!templatePackageDir) {
            return new McpToolError({
              type: 'data-app-template-missing',
              message:
                'The data app template package is not in this build. Rebuild so templates/data-app-template.zip is available.',
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
            worksheetId,
            datasourceId,
            datasources: listed.value.datasources ?? [],
          });
        },
      });
    },
  });
  return tool;
};
