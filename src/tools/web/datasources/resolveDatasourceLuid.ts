import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { useRestApi } from '../../../restApiInstance.js';
import { DataSource } from '../../../sdks/tableau/types/dataSource.js';
import { WebMcpServer } from '../../../server.web.js';
import { paginate } from '../../../utils/paginate.js';
import { ConstrainedResult, WebTool } from '../tool.js';

const paramsSchema = {
  contentUrl: z.string().min(1),
  projectName: z.string().optional(),
};

type ResolvedDatasource = {
  luid: string;
  name: string;
  contentUrl: string;
  projectName?: string;
};

/**
 * Resolve a published datasource's LUID from its `contentUrl` — the URL-safe slug a
 * Tableau Desktop workbook exposes in `<repository-location id="...">`.
 *
 * Why this exists (and why `list-datasources` alone is not enough):
 * - `name` is NOT unique per site (e.g. three datasources all named "Superstore").
 * - `contentUrl` IS unique per site, BUT the REST `contentUrl:eq:` filter is
 *   case-INSENSITIVE, so it can still return >1 (e.g. "Superstore" and "superstore").
 * This tool applies an exact, case-SENSITIVE post-filter (optionally narrowed by
 * project) so the caller gets exactly one LUID or a clear ambiguity/not-found result.
 */
export const getResolveDatasourceLuidTool = (
  server: WebMcpServer,
): WebTool<typeof paramsSchema> => {
  const resolveDatasourceLuidTool = new WebTool({
    server,
    name: 'resolve-datasource-luid',
    description: `
Resolve a published datasource's LUID from its \`contentUrl\` (the unique, URL-safe slug).

Use this to map a Tableau Desktop workbook's published datasource to a Cloud/Server LUID
before calling Pulse/Chiron insight tools. The Desktop workbook exposes the datasource as
\`<repository-location id="<contentUrl>" site="<site>"/>\` — pass that \`id\` as \`contentUrl\`.

Why not \`list-datasources\`? Datasource \`name\` is not unique per site, and the REST
\`contentUrl\` filter is case-insensitive; this tool exact-matches (case-sensitive) so you
get exactly one datasource.

**Parameters:**
- \`contentUrl\` (required): exact, case-sensitive contentUrl from the Desktop repository-location id.
- \`projectName\` (optional): narrow further if two datasources somehow collide.

**Returns:** \`{ luid, name, contentUrl, projectName }\` for the single match, or an
explicit not-found / ambiguous message.
`,
    paramsSchema,
    annotations: {
      title: 'Resolve Datasource LUID',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    callback: async ({ contentUrl, projectName }, extra): Promise<CallToolResult> => {
      const configWithOverrides = await extra.getConfigWithOverrides();
      return await resolveDatasourceLuidTool.logAndExecute<Array<DataSource>>({
        extra,
        args: { contentUrl, projectName },
        callback: async () => {
          const datasources = await useRestApi({
            ...extra,
            jwtScopes: resolveDatasourceLuidTool.requiredApiScopes,
            callback: async (restApi) =>
              await paginate({
                pageConfig: { pageSize: 100, limit: 1000 },
                getDataFn: async (pageConfig) => {
                  const { pagination, datasources: data } =
                    await restApi.datasourcesMethods.listDatasources({
                      siteId: restApi.siteId,
                      // Server filter is case-insensitive; we exact-match below.
                      filter: `contentUrl:eq:${contentUrl}`,
                      pageSize: pageConfig.pageSize,
                      pageNumber: pageConfig.pageNumber,
                    });
                  return { pagination, data };
                },
              }),
          });

          return new Ok(datasources);
        },
        constrainSuccessResult: (datasources): ConstrainedResult<Array<DataSource>> => {
          const { datasourceIds } = configWithOverrides.boundedContext;

          let matches = datasources.filter((ds) => ds.contentUrl === contentUrl);
          if (projectName) {
            matches = matches.filter((ds) => ds.project.name === projectName);
          }
          if (datasourceIds) {
            matches = matches.filter((ds) => datasourceIds.has(ds.id));
          }

          if (matches.length === 0) {
            return {
              type: 'empty',
              message: `No published datasource found with contentUrl "${contentUrl}"${
                projectName ? ` in project "${projectName}"` : ''
              }. Confirm the contentUrl (exact case) from the Desktop repository-location and that you have access.`,
            };
          }

          if (matches.length > 1) {
            const candidates = matches
              .map((ds) => `${ds.name} (LUID ${ds.id}, project "${ds.project.name}")`)
              .join('; ');
            return {
              type: 'error',
              message: `Ambiguous: ${matches.length} datasources share contentUrl "${contentUrl}". Re-call with projectName to disambiguate. Candidates: ${candidates}`,
            };
          }

          return { type: 'success', result: matches };
        },
        getSuccessResult: (matches) => {
          const ds = matches[0];
          const resolved: ResolvedDatasource = {
            luid: ds.id,
            name: ds.name,
            contentUrl: ds.contentUrl ?? contentUrl,
            projectName: ds.project.name,
          };
          return { isError: false, content: [{ type: 'text', text: JSON.stringify(resolved) }] };
        },
      });
    },
  });

  return resolveDatasourceLuidTool;
};
