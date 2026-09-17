import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { WorkbookNotAllowedError } from '../../../errors/mcpToolError.js';
import { log } from '../../../logging/logger.js';
import { BoundedContext } from '../../../overridableConfig.js';
import { useRestApi } from '../../../restApiInstance.js';
import {
  filterLineageContentsByAllowedIds,
  getWorkbookLineageQuery,
  getWorkbookLineageWithParentsByLuid,
  LineageContent,
  mergeWorkbookDatasources,
  mergeWorkbookLineage,
  PublishedParent,
  toEmbeddedLineageContents,
} from '../../../sdks/tableau/methods/lineageUtils.js';
import VizqlDataServiceMethods from '../../../sdks/tableau/methods/vizqlDataServiceMethods.js';
import { SiteRole } from '../../../sdks/tableau/types/user.js';
import { Workbook, WorkbookConnection } from '../../../sdks/tableau/types/workbook.js';
import { WebMcpServer } from '../../../server.web.js';
import { getExceptionMessage } from '../../../utils/getExceptionMessage.js';
import { resourceAccessChecker } from '../resourceAccessChecker.js';
import { WebTool } from '../tool.js';
import { TableauWebRequestHandlerExtra } from '../toolContext.js';
import { getDefaultViewWebUrl } from '../utils/viewUrlUtils.js';

const paramsSchema = {
  workbookId: z.string(),
};

export const getGetWorkbookTool = (server: WebMcpServer): WebTool<typeof paramsSchema> => {
  const getWorkbookTool = new WebTool({
    server,
    name: 'get-workbook',
    minRequiredRole: SiteRole.VIEWER,
    description:
      'Retrieves information about the specified workbook, including information about the views contained in the workbook and backing datasources. ' +
      "The response's upstreamDatasources list each data source the workbook depends on; " +
      "an entry's isQueryable is true when the calling user can query that data source with the query-datasource tool, " +
      'false when they cannot, and absent when it could not be determined.',
    paramsSchema,
    annotations: {
      title: 'Get Workbook',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    callback: async ({ workbookId }, extra): Promise<CallToolResult> => {
      const configWithOverrides = await extra.getConfigWithOverrides();

      return await getWorkbookTool.logAndExecute<{ data: Workbook; url: string }>({
        extra,
        args: { workbookId },
        callback: async () => {
          const isWorkbookAllowedResult = await resourceAccessChecker.isWorkbookAllowed({
            workbookId,
            extra,
          });

          if (!isWorkbookAllowedResult.allowed) {
            return new WorkbookNotAllowedError(isWorkbookAllowedResult.message).toErr();
          }

          const workbook = await useRestApi({
            ...extra,
            jwtScopes: getWorkbookTool.requiredApiScopes,
            callback: async (restApi) => {
              // Notice that we already have the workbook if it had been allowed by a project scope.
              const workbook =
                isWorkbookAllowedResult.content ??
                (await restApi.workbooksMethods.getWorkbook({
                  workbookId,
                  siteId: restApi.siteId,
                }));

              // The views returned by the getWorkbook API do not include usage statistics.
              // Query the views for the workbook to get each view's usage statistics.
              if (workbook.views) {
                const views = await restApi.viewsMethods.queryViewsForWorkbook({
                  workbookId,
                  siteId: restApi.siteId,
                  includeUsageStatistics: true,
                });

                workbook.views.view = views;
              }

              // Embedded datasource discovery via REST /connections. Runs regardless of
              // disableMetadataApiRequests since it does not use the Metadata API. The
              // connection's datasource.id is the VDS-queryable embedded LUID.
              let connections: Array<WorkbookConnection> = [];
              try {
                connections = await restApi.workbooksMethods.queryWorkbookConnections({
                  workbookId: workbook.id,
                  siteId: restApi.siteId,
                });
              } catch (error) {
                log(
                  {
                    message: `Failed to enrich workbook ${workbook.id} with embedded data sources`,
                    level: 'warning',
                    logger: 'lineage',
                    data: getExceptionMessage(error),
                  },
                  extra,
                );
              }

              // Published lineage plus the embedded->published-parent linkage, from one response.
              let published: Array<LineageContent> = [];
              let embeddedParents: Map<string, PublishedParent> = new Map();
              if (!configWithOverrides.disableMetadataApiRequests) {
                try {
                  const response = await restApi.metadataMethods.graphql(
                    getWorkbookLineageQuery([workbook.id], { includeEmbeddedParents: true }),
                  );
                  const lineage = getWorkbookLineageWithParentsByLuid(response).get(workbook.id);
                  published = (lineage?.upstreamDatasources ?? []).map((ds) => ({
                    ...ds,
                    datasourceType: 'published' as const,
                  }));
                  embeddedParents = lineage?.embeddedParents ?? new Map();
                } catch (error) {
                  log(
                    {
                      message: `Failed to enrich workbook ${workbook.id} with lineage metadata`,
                      level: 'warning',
                      logger: 'lineage',
                      data: getExceptionMessage(error),
                    },
                    extra,
                  );
                }
              }

              // Pure transforms below, but wrapped so a throw degrades to the unenriched workbook
              // rather than failing the whole call (matching the enrichment fetches above).
              try {
                const allowedIds = configWithOverrides.boundedContext.datasourceIds;
                const embedded = toEmbeddedLineageContents(connections, embeddedParents);
                // Filter each list against the bounded context BEFORE de-duping: a standalone
                // published entry is dropped only when a *surviving* embedded stub still carries it
                // as publishedParent, so an out-of-bounds stub can't suppress its in-bounds parent.
                const merged = mergeWorkbookDatasources(
                  filterLineageContentsByAllowedIds(published, allowedIds),
                  filterLineageContentsByAllowedIds(embedded, allowedIds),
                );
                const mergedWorkbook = mergeWorkbookLineage(
                  [workbook],
                  new Map([[workbook.id, merged]]),
                )[0];

                return await enrichUpstreamDatasourceQueryability({
                  workbook: mergedWorkbook,
                  vizqlDataServiceMethods: restApi.vizqlDataServiceMethods,
                  extra,
                });
              } catch (error) {
                log(
                  {
                    message: `Failed to assemble upstream data sources for workbook ${workbook.id}`,
                    level: 'warning',
                    logger: 'lineage',
                    data: getExceptionMessage(error),
                  },
                  extra,
                );
                return workbook;
              }
            },
          });

          return new Ok({
            data: workbook,
            url: '', // Placeholder, will be computed in constrainSuccessResult
          });
        },
        constrainSuccessResult: (result) => {
          const { data: workbook } = result;

          const filteredWorkbook = filterWorkbookViews({
            workbook,
            boundedContext: configWithOverrides.boundedContext,
          });

          const url =
            getDefaultViewWebUrl(filteredWorkbook, extra.config.server, extra.getSiteName()) ??
            filteredWorkbook.webpageUrl ??
            '';

          return {
            type: 'success',
            result: {
              data: filteredWorkbook,
              url,
            },
          };
        },
      });
    },
  });

  return getWorkbookTool;
};

/**
 * Annotates each upstream data source with `isQueryable` by calling VDS's user-has-query-permissions
 * endpoint once per data source (concurrently). Maps the result to:
 *  - 200 → the API's `hasQueryPermission` value.
 *  - 403, or feature-disabled (404, no endpoint on older servers) → `false`: the caller can't query it.
 *  - Anything else (401, transient 429/5xx, zodios-error, thrown) → left unset (indeterminate).
 *
 * Best-effort: a failed check never fails get-workbook.
 */
export async function enrichUpstreamDatasourceQueryability({
  workbook,
  vizqlDataServiceMethods,
  extra,
}: {
  workbook: Workbook;
  vizqlDataServiceMethods: VizqlDataServiceMethods;
  extra: TableauWebRequestHandlerExtra;
}): Promise<Workbook> {
  const upstreamDatasources = workbook.upstreamDatasources;
  if (!upstreamDatasources?.length) {
    return workbook;
  }

  const enriched = await Promise.all(
    upstreamDatasources.map(async (ds) => {
      let detail: string;
      try {
        const result = await vizqlDataServiceMethods.userHasQueryPermissions({
          datasource: { datasourceLuid: ds.luid },
        });
        if (result.isOk()) {
          return { ...ds, isQueryable: result.value.hasQueryPermission };
        }
        // isQueryable is false in these scenarios:
        // * 403 (feature off or access denied)
        // * feature-disabled (404, no endpoint on older servers).
        if (
          result.error.type === 'feature-disabled' ||
          (result.error.type === 'api-error' && result.error.httpStatus === 403)
        ) {
          return { ...ds, isQueryable: false };
        }
        detail = JSON.stringify(result.error);
      } catch (error) {
        detail = getExceptionMessage(error);
      }

      log(
        {
          message: `Could not determine queryability for data source ${ds.luid}`,
          level: 'warning',
          logger: 'lineage',
          data: detail,
        },
        extra,
      );
      return ds;
    }),
  );

  return { ...workbook, upstreamDatasources: enriched };
}

export function filterWorkbookViews({
  workbook,
  boundedContext,
}: {
  workbook: Workbook;
  boundedContext: BoundedContext;
}): Workbook {
  const { viewIds, tags } = boundedContext;

  // We don't need to check the tags on the workbook since we already
  // did that before getting the detailed workbook information.
  // We only need to check the views on the workbook against viewIds and tags.
  if (!workbook.views || (!viewIds && !tags)) {
    return flattenWorkbookViewUsage(workbook);
  }

  let views = workbook.views.view;

  if (viewIds) {
    views = views.filter((view) => (view.id ? viewIds.has(view.id) : false));
  }

  if (tags) {
    views = views.filter((view) => view.tags?.tag?.some((tag) => tags.has(tag.label)));
  }

  return flattenWorkbookViewUsage({
    ...workbook,
    views: { view: views },
  });
}

function flattenWorkbookViewUsage(workbook: Workbook): Workbook {
  if (!workbook.views) {
    return workbook;
  }

  return {
    ...workbook,
    views: {
      view: workbook.views.view.map(({ usage, ...view }) => ({
        ...view,
        totalViewCount: usage?.totalViewCount ?? 0,
      })),
    },
  };
}

export const exportedForTesting = {
  getDefaultViewWebUrl,
};
