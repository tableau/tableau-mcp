import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { getFeatureGate } from '../../../features/init.js';
import { ProductVersion } from '../../../sdks/tableau/types/serverInfo.js';
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
  datasourceLuid: z
    .string()
    .nonempty()
    .optional()
    .describe(
      'Optional LUID of a published Tableau datasource on the same site/server to wire into the scaffolded workbook, so the returned data app is already query-ready instead of needing a manual wiring pass. Only wires the same-site/same-server case for a freshly-scaffolded (not already-wired) workbook. Wires every field on the datasource.',
    ),
};

export const getScaffoldDataAppTool = (
  server: WebMcpServer,
  productVersion: ProductVersion,
): WebTool<typeof paramsSchema> => {
  const scaffoldDataAppTool = new WebTool({
    server,
    name: 'scaffold-data-app',
    minRequiredRole: SiteRole.EXPLORER_CAN_PUBLISH,
    description:
      'Scaffolds a new Tableau data app workspace: a starter Tableau viz (worksheet) extension that queries a published datasource live via the Extensions API. Provide `datappName`; the tool derives the package id, display name, and author and returns a ready-to-use workspace (a workbook plus an extension package containing index.html and a src/app.js starter you author the query and visualization into) that is always fully finalized server-side. Optionally provide `datasourceLuid` to also wire a published datasource on the same site/server into the workbook (every field on it), so the returned data app is already query-ready. If S3 storage is configured, the finished workspace is zipped and uploaded, and a short-lived presigned URL to the zip is returned; otherwise the workspace is written to disk on the server and its path is returned. This tool only scaffolds and names the app (and optionally wires a datasource) — it does not author query logic, build, publish, or embed data.',
    paramsSchema,
    annotations: {
      title: 'Scaffold Data App',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    disabled: new Provider(
      async () => !(await getFeatureGate().isFeatureEnabled('tableau-data-apps')),
    ),
    callback: async ({ datappName, datasourceLuid }, extra): Promise<CallToolResult> => {
      return await scaffoldDataAppTool.logAndExecute<DataAppWorkspaceResult>({
        extra,
        args: { datappName, datasourceLuid },
        callback: async () => {
          return createDataAppWorkspace({
            datappName,
            username: extra.tableauAuthInfo?.username,
            config: extra.config,
            extra,
            productVersion,
            datasourceLuid,
          });
        },
        constrainSuccessResult: (result) => ({ type: 'success', result }),
      });
    },
  });

  return scaffoldDataAppTool;
};
