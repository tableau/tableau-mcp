import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { WorkbookNotAllowedError } from '../../../errors/mcpToolError.js';
import { log } from '../../../logging/logger.js';
import { BoundedContext } from '../../../overridableConfig.js';
import { useRestApi } from '../../../restApiInstance.js';
import { QueryPermissionResource } from '../../../sdks/tableau/apis/vizqlDataServiceApi.js';
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
      "an entry's queryability.isQueryable is true when the calling user can query that data source with the query-datasource tool " +
      'and false when they cannot, in which case queryability.reason explains why. ' +
      'The queryability object is omitted entirely when queryability could not be determined.',
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

// User-facing reasons for a non-queryable data source's `queryability.reason`.
const QUERYABILITY_REASONS = {
  featureNotEnabled:
    'Querying workbook (embedded) data sources is not enabled for this Tableau site.',
  permissionDenied: 'The user does not have permission to query this data source.',
} as const;

// Builds a reason from the denied (mode === 'Deny') capabilities returned on a 200 with
// hasQueryPermission=false. Returns undefined when none are present, so the caller can fall back.
function buildQueryabilityReason(
  resources: Array<QueryPermissionResource> | undefined,
): string | undefined {
  const parts = (resources ?? [])
    .map((resource) => {
      const denied = (resource.capabilities ?? [])
        .filter((capability) => capability.mode === 'Deny')
        .map((capability) => capability.name);
      if (!denied.length) {
        return undefined;
      }
      const target = resource.luid
        ? `${resource.resourceType ?? 'data source'} ${resource.luid}`
        : (resource.resourceType ?? 'this data source');
      return `${denied.join(', ')} on ${target}`;
    })
    .filter((part): part is string => part !== undefined);

  return parts.length
    ? `The user is missing required permissions: ${parts.join('; ')}.`
    : undefined;
}

/**
 * Annotates each upstream data source with a `queryability` object by calling VDS's
 * user-has-query-permissions endpoint. The first data source is probed alone: a *systemic* verdict
 * (applies to every data source) is broadcast to all and the rest are skipped; otherwise the
 * remaining data sources are checked concurrently in batches of {@link VDS_QUERYABILITY_CONCURRENCY}.
 * Best-effort: a failed check never fails get-workbook (queryability is just omitted).
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
        const { hasQueryPermission, resources } = result.value;
        const queryability = hasQueryPermission
          ? { isQueryable: true }
          : {
              isQueryable: false,
              reason: buildQueryabilityReason(resources) ?? QUERYABILITY_REASONS.permissionDenied,
            };
        return { datasource: { ...ds, queryability }, systemic: false };
      }
      // Systemic: the feature is off site-wide, so querying is disabled for every data source.
      if (result.error.type === 'workbook-datasource-not-enabled') {
        return {
          datasource: {
            ...ds,
            queryability: { isQueryable: false, reason: QUERYABILITY_REASONS.featureNotEnabled },
          },
          systemic: true,
        };
      }
      // Systemic: the endpoint is absent (older server), so queryability is undeterminable for all.
      if (result.error.type === 'feature-disabled') {
        return { datasource: ds, systemic: true };
      }
      // Per-data-source denials (not systemic): 403800 = no query permission, 404937 = data source
      // not found. VDS's own message names the specific data source, so surface it as the reason.
      if (
        result.error.type === 'api-error' &&
        (result.error.errorCode === '403800' || result.error.errorCode === '404937')
      ) {
        return {
          datasource: {
            ...ds,
            queryability: { isQueryable: false, reason: result.error.message },
          },
          systemic: false,
        };
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

  // Probe the first data source alone; a systemic verdict is broadcast to all, skipping the rest.
  const probe = await checkDatasourceQueryability(first);
  if (probe.systemic) {
    const { queryability } = probe.datasource;
    if (queryability === undefined) {
      return workbook;
    }
    return {
      ...workbook,
      upstreamDatasources: upstreamDatasources.map((ds) => ({ ...ds, queryability })),
    };
  }

  // Non-systemic probe: check the rest concurrently, ≤ VDS_QUERYABILITY_CONCURRENCY calls at a time.
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
  buildQueryabilityReason,
};
