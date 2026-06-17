import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { stat, writeFile } from 'fs/promises';
import { basename, join } from 'path';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { ArgsValidationError, UnknownError } from '../../../errors/mcpToolError.js';
import { WebMcpServer } from '../../../server.web.js';
import { getExceptionMessage } from '../../../utils/getExceptionMessage.js';
import { WebTool } from '../tool.js';
import {
  buildTrexManifest,
  DATA_APP_MANIFEST_FILE,
  DataAppResource,
  extensionIdFor,
  PLACEHOLDER_APP_URL,
  readDataAppManifest,
  rejectPassthroughAuth,
} from './dataAppShared.js';

const REQUIRED_FILES = [
  'index.html',
  'src/tableauData.js',
  'src/app.js',
  'src/config.js',
  'server.js',
  'package.json',
  DATA_APP_MANIFEST_FILE,
];

const paramsSchema = {
  appDir: z
    .string()
    .nonempty()
    .describe('Absolute path to the data app project directory (from scaffold-data-app).'),
};

type PackageResult = {
  appDir: string;
  validatedFiles: string[];
  trexPath: string;
  resources: DataAppResource[];
};

export const getPackageDataAppTool = (server: WebMcpServer): WebTool<typeof paramsSchema> => {
  const packageDataAppTool = new WebTool({
    server,
    name: 'package-data-app',
    description: `
Validates and packages a scaffolded Tableau data app so it is ready to deploy.

What it does:
- Verifies the expected project files exist (index.html, the data shim, app entry, server proxy, package.json).
- Regenerates manifest.trex with a placeholder URL (finalized later by deploy-data-app), using the resource list from dataapp.json.

Use after editing the app and before deploy-data-app. Returns validated files and the wired resources.`,
    paramsSchema,
    annotations: {
      title: 'Package Data App',
      readOnlyHint: false,
      openWorldHint: false,
    },
    callback: async ({ appDir }, extra): Promise<CallToolResult> => {
      return await packageDataAppTool.logAndExecute<PackageResult>({
        extra,
        args: { appDir },
        callback: async () => {
          const passthroughError = rejectPassthroughAuth(extra);
          if (passthroughError) {
            return passthroughError;
          }

          if (!(await isDir(appDir))) {
            return new ArgsValidationError(`appDir is not a directory: ${appDir}`).toErr();
          }

          const validatedFiles: string[] = [];
          for (const rel of REQUIRED_FILES) {
            if (!(await isFile(join(appDir, rel)))) {
              return new ArgsValidationError(
                `Missing required file: ${rel}. Did you scaffold this app with scaffold-data-app?`,
              ).toErr();
            }
            validatedFiles.push(rel);
          }

          const manifest = await readDataAppManifest(appDir);
          if (!manifest || manifest.resources.length === 0) {
            return new ArgsValidationError(
              `Could not read a non-empty resources array from ${DATA_APP_MANIFEST_FILE}. Re-scaffold or fix the manifest.`,
            ).toErr();
          }
          const resources = manifest.resources;

          // Regenerate the canonical .trex with the placeholder URL.
          const appName = basename(appDir);
          const trexPath = join(appDir, 'manifest.trex');
          try {
            await writeFile(
              trexPath,
              buildTrexManifest({
                appName,
                extensionId: extensionIdFor(appName),
                appUrl: PLACEHOLDER_APP_URL,
              }),
              'utf-8',
            );
          } catch (error) {
            return new UnknownError(
              `Failed to write manifest.trex: ${getExceptionMessage(error)}`,
            ).toErr();
          }

          return new Ok<PackageResult>({
            appDir,
            validatedFiles,
            trexPath,
            resources,
          });
        },
        constrainSuccessResult: (result) => ({ type: 'success', result }),
        getSuccessResult: (result) => ({
          isError: false,
          content: [
            {
              type: 'text',
              text: [
                `Package OK — "${basename(result.appDir)}" is ready to deploy.`,
                '',
                `Resources (${result.resources.length}): ${result.resources
                  .map((r) => `${r.name} [${r.type}] ${r.luid}`)
                  .join('; ')}`,
                `Validated files: ${result.validatedFiles.join(', ')}`,
                `manifest.trex: ${result.trexPath} (placeholder URL — finalized on deploy)`,
              ].join('\n'),
            },
          ],
        }),
      });
    },
  });

  return packageDataAppTool;
};

async function isDir(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isDirectory();
  } catch {
    return false;
  }
}

async function isFile(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isFile();
  } catch {
    return false;
  }
}
