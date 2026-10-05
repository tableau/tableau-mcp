import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { getFeatureGate } from '../../../features/init.js';
import { log } from '../../../logging/logger.js';
import { useRestApi } from '../../../restApiInstance.js';
import { ProductVersion } from '../../../sdks/tableau/types/serverInfo.js';
import { SiteRole } from '../../../sdks/tableau/types/user.js';
import { WebMcpServer } from '../../../server.web.js';
import { SCAFFOLD_DATA_APP_API_SCOPES } from '../../../server/oauth/scopes.js';
import { getResultForTableauVersion } from '../../../utils/isTableauVersionAtLeast.js';
import { Provider } from '../../../utils/provider.js';
import { WebTool } from '../tool.js';
import { createDataAppWorkspace, DataAppWorkspaceResult } from './dataAppWorkspaceStore.js';

// Data apps are hosted extension packages, which Tableau can only host on 2026.3.1+.
// Below this floor the scaffolded app can never be published, so the tool is not registered.
const DATA_APP_MIN_PRODUCT_VERSION = '2026.3.1';

function meetsDataAppMinVersion(productVersion: ProductVersion): boolean {
  // Only the explicit 'main' dev-build sentinel gets the benefit of the doubt. A genuinely
  // unparseable version string is "unknown", not "fresh", so it gates the tool OUT rather than
  // in. Parseable versions fall through to the shared helper's year.major.minor floor comparison.
  const { value } = productVersion;
  if (value !== 'main' && value.split('.').map(Number).some(Number.isNaN)) {
    return false;
  }
  return getResultForTableauVersion({
    productVersion,
    mappings: { [DATA_APP_MIN_PRODUCT_VERSION]: true, default: false },
  });
}

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

export const getScaffoldDataAppTool = (
  server: WebMcpServer,
  productVersion: ProductVersion,
): WebTool<typeof paramsSchema> => {
  const scaffoldDataAppTool = new WebTool({
    server,
    name: 'scaffold-data-app',
    minRequiredRole: SiteRole.EXPLORER_CAN_PUBLISH,
    description:
      "Scaffolds a new Tableau data app workspace: a starter Tableau viz (worksheet) extension that queries a published datasource live via the Extensions API. Provide `datappName`; the tool derives the package id and display name and returns a workspace (a workbook plus an extension package containing index.html and a src/app.js starter you author the query and visualization into). Both output modes return the same static, un-substituted template zip plus a `postUnzip` plan describing the identity edits/renames to apply after unzipping; they differ only in transport. If S3 storage is configured, the zip is served as a presigned `s3URL` (download it first). Otherwise a local `filePath` to the zip is returned (skip the download). In both cases the client unzips and applies `postUnzip` to finalize. When available, the result also includes `allowedOrigins` — the site's external allowed-origins allow-list — so you can align the app's outbound fetch and CSP targets with what the Tableau host will permit. This tool only scaffolds and names the app — it does not wire a datasource, author query logic, build, publish, or embed data.",
    paramsSchema,
    annotations: {
      title: 'Scaffold Data App',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    disabled: new Provider(async () => {
      const flagOn = await getFeatureGate().isFeatureEnabled('data-apps');
      const versionAllowed = meetsDataAppMinVersion(productVersion);
      const disabled = !(flagOn && versionAllowed);
      log({
        level: 'info',
        logger: 'tool-registration',
        tool_name: 'scaffold-data-app',
        message: 'Scaffold data app gates evaluated',
        data: {
          featureFlag: 'data-apps',
          featureFlagEnabled: flagOn,
          productVersion: productVersion.value,
          productBuild: productVersion.build,
          minimumProductVersion: DATA_APP_MIN_PRODUCT_VERSION,
          versionAllowed,
          disabled,
        },
      });
      return disabled;
    }),
    callback: async ({ datappName }, extra): Promise<CallToolResult> => {
      return await scaffoldDataAppTool.logAndExecute<DataAppWorkspaceResult>({
        extra,
        args: { datappName },
        callback: async () => {
          const workspaceResult = await createDataAppWorkspace({
            datappName,
            config: extra.config,
          });
          if (workspaceResult.isErr()) {
            return workspaceResult;
          }

          // Best-effort enrichment: surface the site's external allowed-origins so the author can
          // align the app's fetch/CSP targets. The read hits an experimental endpoint gated by the
          // `Packages` feature flag and the `tableau:packages:read` scope; if any of that is
          // unavailable (flag off, 403, etc.) we still return the scaffolded workspace without it.
          let allowedOrigins: string[] | undefined;
          try {
            allowedOrigins = await useRestApi({
              ...extra,
              jwtScopes: SCAFFOLD_DATA_APP_API_SCOPES,
              callback: (restApi) =>
                restApi.packagesMethods.getAllowedOrigins({ siteId: restApi.siteId }),
            });
          } catch {
            allowedOrigins = undefined;
          }

          return new Ok({
            ...workspaceResult.value,
            ...(allowedOrigins ? { allowedOrigins } : {}),
          });
        },
        constrainSuccessResult: (result) => ({ type: 'success', result }),
      });
    },
  });

  return scaffoldDataAppTool;
};
