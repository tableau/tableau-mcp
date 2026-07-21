import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { getDataAppWorkspaceStore } from '../../../dataApps/init.js';
import type { DataAppFile } from '../../../dataApps/types.js';
import { McpToolError } from '../../../errors/mcpToolError.js';
import { buildDataAppPreviewUri } from '../../../resources/dataApps/dataAppPreviewResource.js';
import { WebMcpServer } from '../../../server.web.js';
import { WebTool } from '../tool.js';
import { resolveScopeFromExtra } from './scopeFromExtra.js';
import { buildScaffoldFiles, STATIC_HTML_TEMPLATE } from './templates.js';

const paramsSchema = {
  appName: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .describe(
      'Human-readable name for the data app. Stored in dataapp.json; never used as a filesystem path.',
    ),
  packageId: z
    .string()
    .trim()
    .min(1)
    .max(255)
    .describe(
      'Stable identifier for the app package, e.g. "com.example.myapp". Stored in dataapp.json ' +
        'for later use when packaging for publish; not used to construct a filesystem path.',
    ),
  template: z
    .literal(STATIC_HTML_TEMPLATE)
    .optional()
    .describe(`The scaffold template to use. Only "${STATIC_HTML_TEMPLATE}" exists today.`),
};

export type ScaffoldDataAppResult = {
  appId: string;
  files: DataAppFile[];
  previewUri: string;
  expiresAt: string;
  localPath?: string;
};

/**
 * Creates a new data-app workspace and writes the static scaffold into it.
 *
 * Makes no Tableau REST API call — the workspace lives entirely in the scoped
 * `DataAppWorkspaceStore` (see `src/dataApps/`). The actor scope is derived exclusively from
 * server-verified request signals (`resolveScopeFromExtra`); the caller cannot influence which
 * workspace boundary their new app is created under.
 */
export const getScaffoldDataAppTool = (server: WebMcpServer): WebTool<typeof paramsSchema> => {
  const scaffoldDataAppTool = new WebTool({
    server,
    name: 'scaffold-data-app',
    description: `
Creates a new, empty data-app workspace and writes a minimal static scaffold into it: \`index.html\`,
\`src/app.js\`, \`src/styles.css\`, \`src/data.js\`, and a tool-managed \`dataapp.json\` manifest. The
app is a **static snapshot** — it makes no live Tableau data requests at render time and contains no
proxy server, package manager, or deploy files.

Use \`upsert-data-app-files\` afterward to author the real content (for example, embed data you
already queried into \`src/data.js\`) into the returned \`appId\`. Use \`read-data-app-file\` /
\`list-data-app-files\` to inspect the workspace later. This tool makes no Tableau REST API call.

**Parameters:** \`appName\` (required) — display name, stored in \`dataapp.json\`. \`packageId\`
(required) — stable package identifier, stored in \`dataapp.json\` for later publish packaging.
\`template\` (optional) — reserved for future scaffold variants; only \`"${STATIC_HTML_TEMPLATE}"\`
exists today.

**Result:** \`{ appId, files, previewUri, expiresAt, localPath? }\`. \`appId\` is an opaque handle —
pass it, never a path, to every other data-app tool. \`localPath\` is present only when local-path
exposure has been explicitly enabled for a single-user local stdio server.
`.trim(),
    paramsSchema,
    annotations: {
      title: 'Scaffold Data App',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    callback: async (args, extra): Promise<CallToolResult> => {
      return scaffoldDataAppTool.logAndExecute<ScaffoldDataAppResult>({
        extra,
        args,
        callback: async () => {
          const scope = resolveScopeFromExtra(extra);
          if (scope.isErr()) {
            return scope;
          }

          const scaffoldFiles = buildScaffoldFiles({
            appName: args.appName,
            packageId: args.packageId,
            template: args.template,
          });

          try {
            const workspace = await getDataAppWorkspaceStore().create(scope.value, {
              appName: args.appName,
              packageId: args.packageId,
              template: args.template ?? STATIC_HTML_TEMPLATE,
              files: scaffoldFiles,
            });
            const mayExposeLocalPath =
              extra.config.transport === 'stdio' && extra.config.dataApps.exposeLocalPath;

            return new Ok({
              appId: workspace.appId,
              files: workspace.files,
              previewUri: buildDataAppPreviewUri(workspace.appId),
              expiresAt: workspace.expiresAt.toISOString(),
              ...(mayExposeLocalPath && workspace.localPath
                ? { localPath: workspace.localPath }
                : {}),
            });
          } catch (error) {
            if (error instanceof McpToolError) {
              return error.toErr();
            }
            throw error;
          }
        },
        constrainSuccessResult: (result) => ({ type: 'success', result }),
      });
    },
  });

  return scaffoldDataAppTool;
};
