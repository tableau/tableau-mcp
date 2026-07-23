import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { createHash } from 'crypto';
import { Ok, Result } from 'ts-results-es';
import { z } from 'zod';

import { getDataAppWorkspaceStore } from '../../../dataApps/init.js';
import type { DataAppFile } from '../../../dataApps/types.js';
import {
  ArgsValidationError,
  DatasourceNotAllowedError,
  FeatureDisabledError,
  McpToolError,
} from '../../../errors/mcpToolError.js';
import { buildDataAppPreviewUri } from '../../../resources/dataApps/dataAppPreviewResource.js';
import { useRestApi } from '../../../restApiInstance.js';
import type { DataType, FieldMetadata } from '../../../sdks/tableau/apis/vizqlDataServiceApi.js';
import { WebMcpServer } from '../../../server.web.js';
import type { DataAppFieldDataType } from '../createAndPublishWorkbook/buildTwbx.js';
import { getVizqlDataServiceDisabledError } from '../getVizqlDataServiceDisabledError.js';
import { resourceAccessChecker } from '../resourceAccessChecker.js';
import { WebTool } from '../tool.js';
import { resolveScopeFromExtra } from './scopeFromExtra.js';
import {
  buildScaffoldFiles,
  DataAppDatasourceBinding,
  DataAppFieldBinding,
  LIVE_EXTENSION_TEMPLATE,
} from './templates.js';

const datasourceInputSchema = z.object({
  luid: z
    .string()
    .trim()
    .min(1)
    .describe('Published datasource LUID the live app will query (readMetadataAsync/queryAsync).'),
  contentUrl: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe(
      "The datasource contentUrl (e.g. 'SuperstoreDatasource'). Provide it to skip a REST lookup; " +
        'otherwise scaffold resolves it from the LUID.',
    ),
  name: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe('The datasource display name. Provide it to skip a REST lookup; otherwise resolved.'),
});

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
      'Stable identifier for the app package, e.g. "com.example.myapp". Also the extension id. ' +
        'Stored in dataapp.json; not used to construct a filesystem path.',
    ),
  datasources: z
    .array(datasourceInputSchema)
    .min(1)
    .max(8)
    .describe(
      'The published datasource(s) the app queries live. A single tiny "zombie" worksheet is wired ' +
        'onto the dashboard depending on all of them so the extension can see them at runtime.',
    ),
  template: z
    .literal(LIVE_EXTENSION_TEMPLATE)
    .optional()
    .describe(`The scaffold template to use. Only "${LIVE_EXTENSION_TEMPLATE}" exists today.`),
};

export type ScaffoldDataAppResult = {
  appId: string;
  files: DataAppFile[];
  datasources: Array<{ luid: string; contentUrl: string; name: string }>;
  previewUri: string;
  expiresAt: string;
  localPath?: string;
};

// Derive the sqlproxy connection host/port from the configured SERVER origin. The synthesized
// published-datasource reference connects to Data Server on this host, so it must match the server.
function parseHostPort(serverUrl: string): { host: string; port: string } {
  try {
    const u = new URL(serverUrl);
    return { host: u.hostname, port: u.port || (u.protocol === 'https:' ? '443' : '80') };
  } catch {
    return { host: serverUrl, port: '80' };
  }
}

// Deterministic lowercase-hex sqlproxy connection name (stable per contentUrl → byte-stable builds).
function sqlproxyNameFor(contentUrl: string): string {
  return `sqlproxy.${createHash('sha1').update(contentUrl).digest('hex').slice(0, 31)}`;
}

// Only these VDS data types map cleanly to workbook column metadata for the zombie sheet.
function mapDataType(dt: DataType): DataAppFieldDataType | null {
  switch (dt) {
    case 'STRING':
    case 'INTEGER':
    case 'REAL':
    case 'BOOLEAN':
    case 'DATE':
    case 'DATETIME':
      return dt;
    default:
      return null; // SPATIAL / UNKNOWN — skip
  }
}

function isDimension(field: FieldMetadata): boolean {
  const role = (field as { fieldRole?: unknown }).fieldRole;
  // VDS read-metadata exposes fieldRole via passthrough; when absent, treat as a dimension (the safe
  // default for a discrete zombie-sheet pill).
  return typeof role === 'string' ? role.toUpperCase() === 'DIMENSION' : true;
}

// Pick ONE field to place on the zombie sheet. Prefer a STRING dimension (the verified-golden path),
// then any STRING, then any dimension, then any mappable field. Wiring only — never app logic.
function pickField(fields: FieldMetadata[]): DataAppFieldBinding | null {
  const usable = fields.filter(
    (f) => f.fieldName && f.fieldCaption && f.dataType && mapDataType(f.dataType),
  );
  if (usable.length === 0) {
    return null;
  }
  const chosen =
    usable.find((f) => f.dataType === 'STRING' && isDimension(f)) ??
    usable.find((f) => f.dataType === 'STRING') ??
    usable.find(isDimension) ??
    usable[0];
  return {
    fieldName: chosen.fieldName!,
    caption: chosen.fieldCaption!,
    dataType: mapDataType(chosen.dataType!)!,
  };
}

/**
 * Creates a new data-app workspace and writes the live-extension scaffold into it.
 *
 * Unlike the other data-app tools, scaffold makes lightweight Tableau REST + VizQL Data Service
 * calls to WIRE the workbook to its target published datasource(s): it resolves each datasource's
 * identity (contentUrl/name) and picks one field for the invisible "zombie" worksheet the builder
 * places on the dashboard. It does NOT fetch or embed app data or generate query/render logic — the
 * agent authors that in `src/app.js` after introspecting the datasource. The actor scope is derived
 * exclusively from server-verified request signals (`resolveScopeFromExtra`).
 */
export const getScaffoldDataAppTool = (server: WebMcpServer): WebTool<typeof paramsSchema> => {
  const scaffoldDataAppTool = new WebTool({
    server,
    name: 'scaffold-data-app',
    description: `
Creates a new data-app workspace and writes a **live-query** scaffold into it: \`index.html\` (loads
the Tableau Extensions API library then \`src/app.js\`), \`src/app.js\` (a live boot skeleton), 
\`src/styles.css\`, and a tool-managed \`dataapp.json\` manifest. The app is a bundled **dashboard
extension** that queries its published datasource(s) LIVE via \`readMetadataAsync\`/\`queryAsync\` —
there is NO embedded data snapshot.

Provide the target published \`datasources\` up front. Scaffold makes lightweight REST + VizQL Data
Service calls to resolve each datasource's identity and to wire an invisible tiny "zombie" worksheet
onto the dashboard that depends on all of them (a dashboard extension can only see datasources used
by a worksheet on its own dashboard). It does NOT embed data or write query logic — author that in
\`src/app.js\` (use \`get-datasource-metadata\` / \`query-datasource\` to introspect first), then
\`validate-workbook-package\` and \`create-and-publish-workbook\`. Review the live app in Tableau
after publishing (a live query cannot run outside the Tableau host).

**Parameters:** \`appName\` (required) — display name. \`packageId\` (required) — stable package id /
extension id. \`datasources\` (required) — array of \`{ luid, contentUrl?, name? }\`; supply
contentUrl/name to skip the REST lookup. \`template\` (optional) — only \`"${LIVE_EXTENSION_TEMPLATE}"\`.

**Result:** \`{ appId, files, datasources, previewUri, expiresAt, localPath? }\`. \`appId\` is an opaque
handle — pass it, never a path, to every other data-app tool.
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

          const serverUrl = extra.tableauAuthInfo?.server || extra.config.server;
          const { host, port } = parseHostPort(serverUrl);

          // Resolve every datasource's identity + zombie field via REST/VDS under a single session.
          const bindingsResult = await useRestApi<Result<DataAppDatasourceBinding[], McpToolError>>(
            {
              ...extra,
              jwtScopes: scaffoldDataAppTool.requiredApiScopes,
              callback: async (restApi) => {
                const bindings: DataAppDatasourceBinding[] = [];
                for (const dsIn of args.datasources) {
                  const allowed = await resourceAccessChecker.isDatasourceAllowed({
                    datasourceLuid: dsIn.luid,
                    extra,
                  });
                  if (!allowed.allowed) {
                    return new DatasourceNotAllowedError(allowed.message).toErr();
                  }

                  // Identity: use client-supplied contentUrl/name; otherwise reconcile via REST.
                  let contentUrl = dsIn.contentUrl;
                  let name = dsIn.name;
                  if (!contentUrl || !name) {
                    try {
                      const ds = await restApi.datasourcesMethods.queryDatasource({
                        siteId: restApi.siteId,
                        datasourceId: dsIn.luid,
                      });
                      contentUrl = contentUrl ?? ds.contentUrl;
                      name = name ?? ds.name;
                    } catch {
                      return new ArgsValidationError(
                        `Could not look up datasource '${dsIn.luid}'. Confirm the LUID is a published ` +
                          'datasource on this site, or pass contentUrl and name explicitly.',
                      ).toErr();
                    }
                  }
                  if (!contentUrl) {
                    return new ArgsValidationError(
                      `Could not resolve a contentUrl for datasource '${dsIn.luid}'. Pass contentUrl explicitly.`,
                    ).toErr();
                  }

                  // One field for the zombie sheet (wiring only), from VDS read-metadata.
                  const meta = await restApi.vizqlDataServiceMethods.readMetadata({
                    datasource: { datasourceLuid: dsIn.luid },
                  });
                  if (meta.isErr()) {
                    return new FeatureDisabledError(getVizqlDataServiceDisabledError()).toErr();
                  }
                  const field = pickField(meta.value.data ?? []);
                  if (!field) {
                    return new ArgsValidationError(
                      `Datasource '${name ?? dsIn.luid}' exposes no field usable to wire the workbook.`,
                    ).toErr();
                  }

                  bindings.push({
                    luid: dsIn.luid,
                    contentUrl,
                    name: name ?? contentUrl,
                    sqlproxyName: sqlproxyNameFor(contentUrl),
                    host,
                    port,
                    field,
                  });
                }
                return new Ok(bindings);
              },
            },
          );

          if (bindingsResult.isErr()) {
            return bindingsResult;
          }
          const datasources = bindingsResult.value;

          const scaffoldFiles = buildScaffoldFiles({
            appName: args.appName,
            packageId: args.packageId,
            template: args.template,
            datasources,
          });

          try {
            const workspace = await getDataAppWorkspaceStore().create(scope.value, {
              appName: args.appName,
              packageId: args.packageId,
              template: args.template ?? LIVE_EXTENSION_TEMPLATE,
              files: scaffoldFiles,
            });
            const mayExposeLocalPath =
              extra.config.transport === 'stdio' && extra.config.dataApps.exposeLocalPath;

            return new Ok({
              appId: workspace.appId,
              files: workspace.files,
              datasources: datasources.map((d) => ({
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

  return scaffoldDataAppTool;
};
