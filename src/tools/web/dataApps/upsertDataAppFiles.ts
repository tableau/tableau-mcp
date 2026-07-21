import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { getDataAppWorkspaceStore } from '../../../dataApps/init.js';
import { appIdSchema } from '../../../dataApps/opaqueId.js';
import type { DataAppFile } from '../../../dataApps/types.js';
import { McpToolError, UnsafeWorkspacePathError } from '../../../errors/mcpToolError.js';
import { WebMcpServer } from '../../../server.web.js';
import { WebTool } from '../tool.js';
import { resolveScopeFromExtra } from './scopeFromExtra.js';

const paramsSchema = {
  appId: appIdSchema,
  files: z
    .array(
      z.object({
        path: z
          .string()
          .min(1)
          .describe('Workspace-relative POSIX path, e.g. "src/app.js" or "src/data.js".'),
        content: z.string().describe('UTF-8 file content to write.'),
      }),
    )
    .min(1)
    .describe(
      'One or more files to write in a single atomic batch. Every path/content item is validated ' +
        'before anything is written; if any item fails, nothing in the batch is written.',
    ),
};

export type UpsertDataAppFilesResult = {
  files: DataAppFile[];
  digest: string;
};

/**
 * Writes a batch of UTF-8 files into an existing data-app workspace in one atomic call.
 *
 * Makes no Tableau REST API call. `dataapp.json` is a tool-managed manifest and cannot be
 * overwritten by this tool (the store rejects the whole batch if attempted — nothing partial is
 * written). The actor scope is derived exclusively from server-verified request signals, so this
 * tool can only ever touch workspaces created under the caller's own scope.
 */
export const getUpsertDataAppFilesTool = (server: WebMcpServer): WebTool<typeof paramsSchema> => {
  const upsertDataAppFilesTool = new WebTool({
    server,
    name: 'upsert-data-app-files',
    description: `
Writes one or more UTF-8 files into an existing data-app workspace (created by
\`scaffold-data-app\`) in a single atomic batch. Every path/content item is validated — path
containment, per-file size, file count, and total workspace size — before anything is written; if
any item fails, the whole batch is rejected and nothing changes. This tool makes no Tableau REST
API call.

\`dataapp.json\` is a tool-managed manifest and cannot be overwritten by this tool; attempting to
include it in \`files\` fails the whole batch.

**Parameters:** \`appId\` (required) — the workspace handle from \`scaffold-data-app\`. \`files\`
(required) — one or more \`{ path, content }\` entries; \`content\` is UTF-8 text.

**Result:** \`{ files, digest }\` — \`files\` lists the path and byte size of each file just written;
\`digest\` is the content digest of the whole workspace immediately after this batch.
`.trim(),
    paramsSchema,
    annotations: {
      title: 'Upsert Data App Files',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    callback: async (args, extra): Promise<CallToolResult> => {
      return upsertDataAppFilesTool.logAndExecute<UpsertDataAppFilesResult>({
        extra,
        args,
        callback: async () => {
          // This public tool owns the protected-manifest contract independently of the selected
          // store provider. Validate the entire batch before resolving/calling the provider, so a
          // permissive injected provider cannot overwrite the tool-managed manifest.
          const protectedManifest = args.files.find((file) => isProtectedManifestPath(file.path));
          if (protectedManifest) {
            return new UnsafeWorkspacePathError(
              `Cannot overwrite protected workspace file: ${protectedManifest.path}`,
            ).toErr();
          }

          const scope = resolveScopeFromExtra(extra);
          if (scope.isErr()) {
            return scope;
          }

          try {
            const result = await getDataAppWorkspaceStore().upsertFiles(
              scope.value,
              args.appId,
              args.files.map((file) => ({ path: file.path, content: file.content })),
            );

            return new Ok(result);
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

  return upsertDataAppFilesTool;
};

function isProtectedManifestPath(path: string): boolean {
  return (
    path.replace(/^\.\//, '').replace(/\/+/g, '/').normalize('NFC').toLowerCase() === 'dataapp.json'
  );
}
