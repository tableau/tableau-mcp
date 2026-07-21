import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';

import { getDataAppWorkspaceStore } from '../../../dataApps/init.js';
import { appIdSchema } from '../../../dataApps/opaqueId.js';
import type { DataAppFile } from '../../../dataApps/types.js';
import { McpToolError } from '../../../errors/mcpToolError.js';
import { WebMcpServer } from '../../../server.web.js';
import { WebTool } from '../tool.js';
import { resolveScopeFromExtra } from './scopeFromExtra.js';

const paramsSchema = {
  appId: appIdSchema,
};

export type ListDataAppFilesResult = {
  files: DataAppFile[];
};

/**
 * Lists every file currently stored in a data-app workspace, with path and byte size only — never
 * a filesystem path.
 *
 * Exists so clients without direct filesystem access (Claude Web, remote MCP connectors) can
 * resume authoring an existing workspace by `appId` alone. Makes no Tableau REST API call. The
 * actor scope is derived exclusively from server-verified request signals, so this tool can only
 * ever list a workspace created under the caller's own scope.
 */
export const getListDataAppFilesTool = (server: WebMcpServer): WebTool<typeof paramsSchema> => {
  const listDataAppFilesTool = new WebTool({
    server,
    name: 'list-data-app-files',
    description: `
Lists every file currently stored in a data-app workspace (created by \`scaffold-data-app\`), with
path and byte size only. Use this to resume authoring an existing workspace by \`appId\` alone —
no filesystem access is required. This tool makes no Tableau REST API call and never returns a
filesystem path.

**Parameters:** \`appId\` (required) — the workspace handle.

**Result:** \`{ files }\` — an array of \`{ path, bytes }\` for every file currently in the workspace.
`.trim(),
    paramsSchema,
    annotations: {
      title: 'List Data App Files',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    callback: async (args, extra): Promise<CallToolResult> => {
      return listDataAppFilesTool.logAndExecute<ListDataAppFilesResult>({
        extra,
        args,
        callback: async () => {
          const scope = resolveScopeFromExtra(extra);
          if (scope.isErr()) {
            return scope;
          }

          try {
            const files = await getDataAppWorkspaceStore().listFiles(scope.value, args.appId);
            return new Ok({ files });
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

  return listDataAppFilesTool;
};
