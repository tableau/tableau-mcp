import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { mkdir, readdir, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { ArgsValidationError, UnknownError } from '../../../errors/mcpToolError.js';
import { WebMcpServer } from '../../../server.web.js';
import { getExceptionMessage } from '../../../utils/getExceptionMessage.js';
import { WebTool } from '../tool.js';
import {
  DATA_APP_RESOURCE_TYPES,
  getDataAppDir,
  normalizeResources,
  rejectPassthroughAuth,
  resolveOutDir,
  slugify,
} from './dataAppShared.js';
import { getScaffoldFiles } from './templates.js';

const resourceSchema = z.object({
  type: z
    .enum(DATA_APP_RESOURCE_TYPES)
    .describe('Resource kind: "datasource", "view", "workbook", or "metric" (Pulse).'),
  luid: z.string().nonempty().describe('LUID of the Tableau content resource.'),
  name: z
    .string()
    .optional()
    .describe('Optional friendly handle the app code can reference, e.g. "hbiUsage".'),
});

const paramsSchema = {
  appName: z
    .string()
    .nonempty()
    .describe('Human-readable name of the data app, e.g. "Sales Overview".'),
  datasourceLuid: z
    .string()
    .optional()
    .describe(
      'Convenience shortcut for a single primary data source: its published LUID. Equivalent to adding { type: "datasource", luid } to resources. Optional if `resources` is provided.',
    ),
  resources: z
    .array(resourceSchema)
    .optional()
    .describe(
      'Arbitrary array of Tableau content resources the app is wired to (datasources, views, workbooks, and/or Pulse metrics). The app queries each via the matching window.tableauData.* method. Provide this and/or datasourceLuid; at least one resource is required.',
    ),
  framework: z
    .enum(['html', 'react'])
    .optional()
    .describe(
      'App framework for the entry stub. "html" (vanilla, default) or "react" (build-free Preact via ESM CDN).',
    ),
  appTitle: z.string().optional().describe('Optional display title; defaults to appName.'),
  outDir: z
    .string()
    .optional()
    .describe(
      "Directory to create the project in, on the machine running this MCP server (NOT your sandbox). The project is created at <outDir>/<slug>. If you are a hosted/sandboxed agent without direct access to the user's filesystem, OMIT this — paths from your environment (e.g. /home/user, /workspace, /tmp) do not exist on the user's machine. When omitted, the tool picks a writable location and returns the absolute path, which you should pass to the other data-app tools.",
    ),
  overwrite: z
    .boolean()
    .optional()
    .describe(
      'If true, scaffold into an existing non-empty directory (overwrites matching files). Defaults to false.',
    ),
};

type ScaffoldResult = {
  appDir: string;
  framework: 'html' | 'react';
  files: string[];
  trexPath: string;
  nextSteps: string[];
};

export const getScaffoldDataAppTool = (server: WebMcpServer): WebTool<typeof paramsSchema> => {
  const scaffoldDataAppTool = new WebTool({
    server,
    name: 'scaffold-data-app',
    description: `
Scaffolds a new vibe-coded Tableau data app project on disk, ready to be packaged as a Dashboard Extension (.trex) and hosted by Tableau.

Before generating app code, read the \`skill://vibe-code-data-app\` resource — it defines the hard rules (never hardcode data; always fetch via the data-access shim) and the narrative/style contract.

The app can be wired to an arbitrary array of typed Tableau resources via \`resources\` (or the \`datasourceLuid\` shortcut for a single datasource): each is a datasource, view, workbook, or Pulse metric. The generated app queries each via the matching window.tableauData.* method.

This tool emits a deterministic skeleton you should NOT restructure:
- index.html (loads the Tableau Extensions API + the data shim + your app)
- src/tableauData.js (the data-access shim — do not rewrite)
- src/config.js (inlines the resource list), src/app.js (your entry stub), src/styles.css
- dataapp.json (the machine-readable resource manifest read by package/deploy)
- manifest.trex (Dashboard Extension manifest; URL finalized at deploy time)
- server.js + package.json + Procfile (the co-hosted Tableau data proxy, Heroku-ready)

Use this tool when a user wants to build a Tableau data app / dashboard extension. After scaffolding, fill in src/app.js per the skill, then call package-data-app and deploy-data-app.

Leave \`outDir\` unset unless you know a real path on the user's machine — the tool then picks a writable location for you. (Sandboxed agents: do NOT pass a path from your own container; it won't exist on the user's machine.) The returned absolute path is authoritative — use it verbatim for write-data-app-file/package-data-app/deploy-data-app rather than guessing.

Returns the absolute project directory, the generated file list, and next steps.`,
    paramsSchema,
    annotations: {
      title: 'Scaffold Data App',
      readOnlyHint: false,
      openWorldHint: false,
    },
    callback: async (
      { appName, datasourceLuid, resources, framework, appTitle, outDir, overwrite },
      extra,
    ): Promise<CallToolResult> => {
      return await scaffoldDataAppTool.logAndExecute<ScaffoldResult>({
        extra,
        args: { appName, datasourceLuid, resources, framework, appTitle, outDir, overwrite },
        callback: async () => {
          const passthroughError = rejectPassthroughAuth(extra);
          if (passthroughError) {
            return passthroughError;
          }

          const resolvedResources = normalizeResources({ datasourceLuid, resources });
          if (resolvedResources.length === 0) {
            return new ArgsValidationError(
              'No resources provided. Pass `datasourceLuid` and/or a non-empty `resources` array (datasource/view/workbook/metric LUIDs).',
            ).toErr();
          }

          if (outDir !== undefined) {
            const outDirResult = resolveOutDir(outDir);
            if (!outDirResult.ok) {
              return new ArgsValidationError(outDirResult.message).toErr();
            }
          }

          const resolvedFramework = framework ?? 'html';
          const appDir = getDataAppDir(appName, outDir);

          if (!overwrite) {
            const existing = await readDirSafe(appDir);
            if (existing.length > 0) {
              return new ArgsValidationError(
                `Directory already exists and is not empty: ${appDir}. Pass overwrite: true to scaffold anyway, or choose a different appName.`,
              ).toErr();
            }
          }

          const files = getScaffoldFiles({
            appName,
            appTitle: appTitle ?? appName,
            resources: resolvedResources,
            framework: resolvedFramework,
          });

          try {
            for (const [relPath, content] of Object.entries(files)) {
              const absPath = join(appDir, relPath);
              await mkdir(dirname(absPath), { recursive: true });
              await writeFile(absPath, content, 'utf-8');
            }
          } catch (error) {
            return new UnknownError(
              `Failed to write scaffold files: ${getExceptionMessage(error)}`,
            ).toErr();
          }

          return new Ok<ScaffoldResult>({
            appDir,
            framework: resolvedFramework,
            files: Object.keys(files).sort(),
            trexPath: join(appDir, 'manifest.trex'),
            nextSteps: [
              'Read the skill://vibe-code-data-app resource if you have not already.',
              `Wired to ${resolvedResources.length} resource(s): ${resolvedResources
                .map((r) => `${r.name} (${r.type})`)
                .join(', ')}. Inspect them at runtime via window.tableauData.resources.`,
              'Discover real field captions for datasource resources with the get-datasource-metadata tool.',
              `Edit ${join(appDir, 'src/app.js')} to build the visualization; fetch data only via the window.tableauData.* methods (query / getViewData / getWorkbookViews / getMetrics).`,
              `Run package-data-app with appDir "${appDir}" to validate and bundle.`,
              'Run deploy-data-app to host the app and get the final .trex in your Downloads.',
            ],
          });
        },
        constrainSuccessResult: (result) => ({ type: 'success', result }),
        getSuccessResult: (result) => ({
          isError: false,
          content: [
            {
              type: 'text',
              text: [
                `Scaffolded "${slugify(appName)}" (${result.framework}) at:`,
                `  ${result.appDir}`,
                '',
                'Use this exact path as appDir for write-data-app-file, package-data-app, and deploy-data-app. Do not guess or rewrite it.',
                '',
                'Files:',
                ...result.files.map((f) => `  - ${f}`),
                '',
                'Next steps:',
                ...result.nextSteps.map((s, i) => `  ${i + 1}. ${s}`),
              ].join('\n'),
            },
          ],
        }),
      });
    },
  });

  return scaffoldDataAppTool;
};

async function readDirSafe(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch {
    return [];
  }
}
