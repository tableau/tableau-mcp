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

// Cap on concurrent user-has-query-permissions calls when enriching a workbook's upstream data
// sources, so a workbook with many data sources can't burst an unbounded number of VDS requests.
const VDS_QUERYABILITY_CONCURRENCY = 5;

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
 * endpoint. The first data source is probed on its own: if that probe reports a *systemic* failure
 * (one that applies to every data source), the probe's verdict is broadcast to all entries and the
 * remaining checks are skipped. Otherwise the probe result is kept and the remaining data sources are
 * checked concurrently, in batches of {@link VDS_QUERYABILITY_CONCURRENCY} so VDS isn't hit by an
 * unbounded burst. Each check maps to:
 *  - 200 → the API's `hasQueryPermission` value.
 *  - errorCode 403800 (permission denied) or 404937 (data source not found) → `false`: not queryable.
 *  - workbook-datasource-not-enabled (VDSForWorkbookDatasources off site-wide) → `false`: querying is
 *    disabled. Systemic.
 *  - feature-disabled (endpoint absent — the API isn't available yet) → left unset: queryability is
 *    undeterminable. Systemic.
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

  const checkDatasourceQueryability = async (
    ds: LineageContent,
  ): Promise<{ datasource: LineageContent; systemic: boolean }> => {
    let detail: string;
    try {
      const result = await vizqlDataServiceMethods.userHasQueryPermissions({
        datasource: { datasourceLuid: ds.luid },
      });
      if (result.isOk()) {
        return {
          datasource: { ...ds, isQueryable: result.value.hasQueryPermission },
          systemic: false,
        };
      }
      // workbook-datasource-not-enabled is systemic: the VDSForWorkbookDatasources feature is off
      // site-wide, so the endpoint answered but querying is disabled for EVERY data source →
      // isQueryable false. Flag it so the caller can broadcast false and skip the rest.
      if (result.error.type === 'workbook-datasource-not-enabled') {
        return { datasource: { ...ds, isQueryable: false }, systemic: true };
      }
      // feature-disabled is systemic too, but different: the user-has-query-permissions endpoint is
      // absent on an older server, so it can't answer for ANY data source. Queryability is
      // undeterminable, so isQueryable is left unset. Flag it so the caller can skip the rest.
      if (result.error.type === 'feature-disabled') {
        return { datasource: ds, systemic: true };
      }
      // Per-data-source denials are false but not systemic:
      // * 403800: the caller lacks permission to query this data source
      // * 404937: the data source no longer exists
      if (
        result.error.type === 'api-error' &&
        (result.error.errorCode === '403800' || result.error.errorCode === '404937')
      ) {
        return { datasource: { ...ds, isQueryable: false }, systemic: false };
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
    return { datasource: ds, systemic: false };
  };

  const [first, ...rest] = upstreamDatasources;

  // PROBE: Check the first data source on its own. A systemic failure applies to every data source,
  // so we broadcast the probe's verdict to all of them and skip the remaining checks: an absent
  // endpoint leaves isQueryable unset (undeterminable), while the feature being off site-wide marks
  // every data source false.
  const probe = await checkDatasourceQueryability(first);
  if (probe.systemic) {
    const { isQueryable } = probe.datasource;
    if (isQueryable === undefined) {
      return workbook;
    }
    return {
      ...workbook,
      upstreamDatasources: upstreamDatasources.map((ds) => ({ ...ds, isQueryable })),
    };
  }

  // The first probe succeeded (or failed non-systemically), so check the rest concurrently, in
  // batches so no more than VDS_QUERYABILITY_CONCURRENCY calls hit VDS at once.
  const restEnriched: Array<{ datasource: LineageContent; systemic: boolean }> = [];
  for (let i = 0; i < rest.length; i += VDS_QUERYABILITY_CONCURRENCY) {
    const batch = rest.slice(i, i + VDS_QUERYABILITY_CONCURRENCY);
    restEnriched.push(...(await Promise.all(batch.map((ds) => checkDatasourceQueryability(ds)))));
  }

  return {
    ...workbook,
    upstreamDatasources: [probe.datasource, ...restEnriched.map((r) => r.datasource)],
  };
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
