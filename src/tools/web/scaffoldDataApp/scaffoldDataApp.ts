import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { getFeatureGate } from '../../../features/init.js';
import { SiteRole } from '../../../sdks/tableau/types/user.js';
import { WebMcpServer } from '../../../server.web.js';
import { Provider } from '../../../utils/provider.js';
import { WebTool } from '../tool.js';
import { createDataAppWorkspace, DataAppWorkspaceResult } from './dataAppWorkspaceStore.js';

const paramsSchema = {
  datappName: z
    .string()
    .min(1)
    .max(100)
    .regex(
      /^[A-Za-z0-9](?:[A-Za-z0-9 ._-]{0,98}[A-Za-z0-9])?$/,
      'Name must be 1-100 characters using letters, digits, spaces, dot, underscore, or hyphen, and must start and end with a letter or digit.',
    )
    .refine((value) => !value.includes('..'), 'Name must not contain "..".')
    .describe(
      'Name for the new data app. Used verbatim as the workspace folder name, the workbook (.twb) filename, and the extension display name, and slugified into the extension package id. Letters, digits, spaces, dot, underscore, and hyphen only; no path separators.',
    ),
};

export const getScaffoldDataAppTool = (server: WebMcpServer): WebTool<typeof paramsSchema> => {
  const scaffoldDataAppTool = new WebTool({
    server,
    name: 'scaffold-data-app',
    minRequiredRole: SiteRole.EXPLORER_CAN_PUBLISH,
    description:
      'Scaffolds a new Tableau data app workspace: a starter Tableau viz (worksheet) extension that queries a published datasource live via the Extensions API. Provide `datappName`; the tool derives the package id and display name and returns a workspace (a workbook plus an extension package containing index.html and a src/app.js starter you author the query and visualization into). Both output modes return the same static, un-substituted template zip plus a `postUnzip` plan describing the identity edits/renames to apply after unzipping; they differ only in transport. If S3 storage is configured, the zip is served as a presigned `s3URL` (download it first). Otherwise a local `filePath` to the zip is returned (skip the download). In both cases the client unzips and applies `postUnzip` to finalize. This tool only scaffolds and names the app — it does not wire a datasource, author query logic, build, publish, or embed data.',
    paramsSchema,
    annotations: {
      title: 'Scaffold Data App',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    disabled: new Provider(
      async () => !(await getFeatureGate().isFeatureEnabled('data-apps')),
    ),
    callback: async ({ datappName }, extra): Promise<CallToolResult> => {
      return await scaffoldDataAppTool.logAndExecute<DataAppWorkspaceResult>({
        extra,
        args: { datappName },
        callback: async () => {
          return createDataAppWorkspace({
            datappName,
            config: extra.config,
          });
        },
        constrainSuccessResult: (result) => ({ type: 'success', result }),
      });
    },
  });

  return scaffoldDataAppTool;
};
