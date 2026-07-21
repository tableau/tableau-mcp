import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { getDataAppWorkspaceStore } from '../../../dataApps/init.js';
import { appIdSchema } from '../../../dataApps/opaqueId.js';
import { McpToolError } from '../../../errors/mcpToolError.js';
import { WebMcpServer } from '../../../server.web.js';
import { WebTool } from '../tool.js';
import { resolveScopeFromExtra } from './scopeFromExtra.js';

const paramsSchema = {
  appId: appIdSchema,
  path: z.string().min(1).describe('Workspace-relative POSIX path to read, e.g. "src/app.js".'),
};

export type ReadDataAppFileResult = {
  path: string;
  content: string;
  bytes: number;
};

/**
 * Reads a single workspace file back as UTF-8 text.
 *
 * Exists so clients without direct filesystem access (Claude Web, remote MCP connectors) can
 * inspect workspace state entirely through opaque `appId`/`path` handles — never through a
 * filesystem path. Makes no Tableau REST API call. The actor scope is derived exclusively from
 * server-verified request signals, so this tool can only ever read a workspace created under the
 * caller's own scope; a wrong-scope `appId` returns the same not-found signal as a workspace that
 * never existed.
 */
export const getReadDataAppFileTool = (server: WebMcpServer): WebTool<typeof paramsSchema> => {
  const readDataAppFileTool = new WebTool({
    server,
    name: 'read-data-app-file',
    description: `
Reads a single file from a data-app workspace (created by \`scaffold-data-app\`) back as UTF-8 text.
Use this to inspect workspace state when the client has no direct filesystem access — the MCP tools
are the portable path for every client, including Claude Web and remote connectors. This tool makes
no Tableau REST API call and never returns a filesystem path.

**Parameters:** \`appId\` (required) — the workspace handle. \`path\` (required) — the
workspace-relative file path, e.g. \`"src/app.js"\`.

**Result:** \`{ path, content, bytes }\`. \`content\` is the file's UTF-8 text; \`bytes\` is its size.
`.trim(),
    paramsSchema,
    annotations: {
      title: 'Read Data App File',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    callback: async (args, extra): Promise<CallToolResult> => {
      return readDataAppFileTool.logAndExecute<ReadDataAppFileResult>({
        extra,
        args,
        callback: async () => {
          const scope = resolveScopeFromExtra(extra);
          if (scope.isErr()) {
            return scope;
          }

          try {
            const bytes = await getDataAppWorkspaceStore().readFile(
              scope.value,
              args.appId,
              args.path,
            );
            return new Ok({
              path: args.path,
              content: Buffer.from(bytes).toString('utf8'),
              bytes: bytes.byteLength,
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

  return readDataAppFileTool;
};
