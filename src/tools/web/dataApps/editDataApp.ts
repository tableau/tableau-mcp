import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { getDataAppWorkspaceStore } from '../../../dataApps/init.js';
import type { DataAppFile } from '../../../dataApps/types.js';
import { McpToolError, WorkbookNotAllowedError } from '../../../errors/mcpToolError.js';
import { buildDataAppPreviewUri } from '../../../resources/dataApps/dataAppPreviewResource.js';
import { useRestApi } from '../../../restApiInstance.js';
import { WebMcpServer } from '../../../server.web.js';
import { reconstructWorkspaceFromTwbx } from '../createAndPublishWorkbook/reconstructWorkspaceFromTwbx.js';
import { resourceAccessChecker } from '../resourceAccessChecker.js';
import { WebTool } from '../tool.js';
import { resolveScopeFromExtra } from './scopeFromExtra.js';
import { LIVE_EXTENSION_TEMPLATE } from './templates.js';

const paramsSchema = {
  workbookId: z
    .string()
    .trim()
    .min(1)
    .describe(
      'LUID of the published data-app workbook to reopen for editing. It must be a workbook that ' +
        'was created and published through the data-app flow (scaffold-data-app -> ' +
        'validate-workbook-package -> create-and-publish-workbook); an ordinary Tableau workbook ' +
        'cannot be edited with this tool.',
    ),
};

// Mirrors ScaffoldDataAppResult exactly: a
// reopened app must leave the caller with the same handle + shape a fresh scaffold would, so the
// whole author -> validate -> publish loop works identically afterwards.
export type EditDataAppResult = {
  appId: string;
  files: DataAppFile[];
  datasources: Array<{ luid: string; contentUrl: string; name: string }>;
  previewUri: string;
  expiresAt: string;
  localPath?: string;
};

/**
 * Reopens a workbook that was published through the data-app flow as a fresh, editable workspace.
 *
 * The workbook's packaged bytes are downloaded (structure only — no extract), then inverted back into
 * workspace source (the `content/**` files plus a reconstructed `dataapp.json`) by
 * `reconstructWorkspaceFromTwbx`. Those files are written into a brand-new workspace under the
 * caller's actor scope, so the existing authoring tools (read/list/search/upsert/patch) can iterate
 * on the app.
 *
 * A workbook that was not produced by the scaffold -> publish flow (no `Packages/<id>/manifest.json`,
 * no `content/index.html`, or unreadable bytes) is rejected with a clean `WorkbookDataAppNotFoundError`
 * before any workspace is created.
 */
export const getEditDataAppTool = (server: WebMcpServer): WebTool<typeof paramsSchema> => {
  const editDataAppTool = new WebTool({
    server,
    name: 'edit-data-app',
    description: `
Reopens a workbook that was **published through the data-app flow** as a new, editable data-app
workspace so you can continue iterating on it. It downloads the workbook, unpacks the packaged app
source back into a workspace (the same layout \`scaffold-data-app\` produces), and returns a fresh
\`appId\` handle.

Use this when the user wants to change an existing published data app (edit the visualization, fix a
bug, restyle it) rather than build a new one from scratch. After reopening, author with the usual
data-app tools (\`read-data-app-file\`, \`list-data-app-files\`, \`search-data-app-file\`,
\`upsert-data-app-files\`, \`patch-data-app-file\`), then \`validate-workbook-package\` and
\`create-and-publish-workbook\`. To replace the original workbook rather than create a copy, publish
with \`overwrite: true\` (the caller needs edit/overwrite permission on that workbook).

Only workbooks created by the data-app flow can be reopened: the tool inverts the package the flow
produces (\`Packages/<id>/content\` + the workbook's live datasource references). An ordinary Tableau
workbook has no such package and is rejected. The reopened workspace's datasource bindings carry an
empty \`luid\` — the workbook does not record it and the live app resolves its datasources at runtime,
so this does not affect authoring or republishing.

**Parameters:** \`workbookId\` (required) — LUID of the published data-app workbook to reopen.

**Result:** \`{ appId, files, datasources, previewUri, expiresAt, localPath? }\` — identical in shape to
\`scaffold-data-app\`. \`appId\` is an opaque handle; pass it (never a path) to every other data-app tool.
`.trim(),
    paramsSchema,
    annotations: {
      title: 'Edit Data App',
      // Creates a new server-side workspace from an existing workbook; it never mutates the source
      // workbook (republishing is a separate, explicit step), so it is not destructive.
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    callback: async (args, extra): Promise<CallToolResult> => {
      return editDataAppTool.logAndExecute<EditDataAppResult>({
        extra,
        args,
        callback: async () => {
          const scope = resolveScopeFromExtra(extra);
          if (scope.isErr()) {
            return scope;
          }

          // Gate on the same content-read access check every workbook tool uses. This confirms the
          // caller may see the workbook before we download and unpack it.
          const allowed = await resourceAccessChecker.isWorkbookAllowed({
            workbookId: args.workbookId,
            extra,
          });
          if (!allowed.allowed) {
            return new WorkbookNotAllowedError(allowed.message).toErr();
          }

          // Download the packaged bytes and invert them into workspace source. Data apps are live
          // (no extract), so includeExtract:false keeps the download minimal. reconstructWorkspaceFromTwbx
          // throws WorkbookDataAppNotFoundError (an McpToolError) for bytes that are not a data-app package.
          let reconstructed;
          try {
            reconstructed = await useRestApi({
              ...extra,
              jwtScopes: editDataAppTool.requiredApiScopes,
              callback: async (restApi) => {
                const bytes = await restApi.workbooksMethods.downloadWorkbook({
                  workbookId: args.workbookId,
                  siteId: restApi.siteId,
                  includeExtract: false,
                });
                return reconstructWorkspaceFromTwbx(bytes);
              },
            });
          } catch (error) {
            if (error instanceof McpToolError) {
              return error.toErr();
            }
            throw error;
          }

          try {
            const workspace = await getDataAppWorkspaceStore().create(scope.value, {
              appName: reconstructed.appName,
              packageId: reconstructed.packageId,
              template: LIVE_EXTENSION_TEMPLATE,
              files: reconstructed.files,
            });
            const mayExposeLocalPath =
              extra.config.transport === 'stdio' && extra.config.dataApps.exposeLocalPath;

            return new Ok({
              appId: workspace.appId,
              files: workspace.files,
              datasources: reconstructed.datasources.map((d) => ({
                luid: d.luid,
                contentUrl: d.contentUrl,
                name: d.name,
              })),
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

  return editDataAppTool;
};
