import { z } from 'zod';

import { LineageContent } from '../types/lineageContent.js';
import { View } from '../types/view.js';
import { Workbook, WorkbookConnection } from '../types/workbook.js';

export type { LineageContent };

// Lenient wire-parse schema for Metadata-API GraphQL responses: luid is absent for embedded
// datasources and name can be null, so both are optional here. collectPublishedLineage drops
// entries without a luid before producing the strict LineageContent output shape.
const metadataLineageContentSchema = z.object({
  luid: z.string().optional(),
  name: z.string().nullable().optional(),
});

// Published datasources connected via an embedded datasource are only reliably reachable by
// traversing embeddedDatasources -> upstreamDatasources. The content-level upstreamDatasources
// rollup (on Workbook/Sheet) is a Catalog-computed field that can be empty even when the embedded
// -> published lineage edge is indexed, so we query both and union them. Embedded datasources
// themselves carry no luid, so only their upstream (published) datasources survive normalization.
const metadataEmbeddedDatasourceSchema = z.object({
  upstreamDatasources: z.array(metadataLineageContentSchema).nullish(),
});

const workbookLineageResponseSchema = z.object({
  data: z.object({
    workbooksConnection: z.object({
      nodes: z.array(
        z.object({
          luid: z.string(),
          upstreamDatasources: z.array(metadataLineageContentSchema).nullish(),
          embeddedDatasources: z.array(metadataEmbeddedDatasourceSchema).nullish(),
        }),
      ),
    }),
  }),
});

const viewLineageNodeSchema = z.object({
  luid: z.string(),
  upstreamDatasources: z.array(metadataLineageContentSchema).nullish(),
  workbook: z
    .object({
      luid: z.string(),
      name: z.string().nullable().optional(),
      projectLuid: z.string().nullable().optional(),
      projectName: z.string().nullable().optional(),
      owner: z
        .object({
          luid: z.string().nullable().optional(),
          name: z.string().nullable().optional(),
          username: z.string().nullable().optional(),
        })
        .nullish(),
      embeddedDatasources: z.array(metadataEmbeddedDatasourceSchema).nullish(),
    })
    .nullish(),
});

const viewLineageConnectionSchema = z
  .object({
    nodes: z.array(viewLineageNodeSchema),
  })
  .nullish();

const viewLineageResponseSchema = z.object({
  data: z.object({
    // REST "views" include worksheets and dashboards; Metadata API models them separately.
    sheetsConnection: viewLineageConnectionSchema,
    dashboardsConnection: viewLineageConnectionSchema,
  }),
});

// Shared GraphQL selection for embedded datasources' upstream (published) datasources. See
// metadataEmbeddedDatasourceSchema for why we traverse embeddedDatasources rather than relying
// solely on the content-level upstreamDatasources rollup.
const embeddedUpstreamSelection = `embeddedDatasources {
            upstreamDatasources {
              luid
              name
            }
          }`;

// Shared node selection for workbook lineage, used by both the single-workbook query and the
// combined search-content query so the two never drift.
const workbookLineageNodesSelection = `nodes {
          luid
          upstreamDatasources {
            luid
            name
          }
          ${embeddedUpstreamSelection}
        }`;

function getViewLineageConnectionQuery(connectionName: string, viewLuids: Array<string>): string {
  return `${connectionName}(filter: { luidWithin: ${toGraphqlStringArray(viewLuids)} }) {
        nodes {
          luid
          upstreamDatasources {
            name
            ... on PublishedDatasource {
              luid
            }
          }
          workbook {
            luid
            name
            projectLuid
            projectName
            owner {
              luid
              name
              username
            }
            ${embeddedUpstreamSelection}
          }
        }
      }`;
}

export function getWorkbookLineageQuery(workbookLuids: Array<string>): string {
  return `
    query workbookLineage {
      workbooksConnection(filter: { luidWithin: ${toGraphqlStringArray(workbookLuids)} }) {
        ${workbookLineageNodesSelection}
      }
    }
  `;
}

export function getViewLineageQuery(viewLuids: Array<string>): string {
  return `
    query viewLineage {
      ${getViewLineageConnectionQuery('sheetsConnection', viewLuids)}
      ${getViewLineageConnectionQuery('dashboardsConnection', viewLuids)}
    }
  `;
}

export function getSearchContentLineageQuery({
  workbookLuids,
  viewLuids,
}: {
  workbookLuids: Array<string>;
  viewLuids: Array<string>;
}): string {
  return `
    query searchContentLineage {
      ${
        workbookLuids.length
          ? `workbooksConnection(filter: { luidWithin: ${toGraphqlStringArray(workbookLuids)} }) {
        ${workbookLineageNodesSelection}
      }`
          : ''
      }
      ${
        viewLuids.length
          ? `${getViewLineageConnectionQuery('sheetsConnection', viewLuids)}
      ${getViewLineageConnectionQuery('dashboardsConnection', viewLuids)}`
          : ''
      }
    }
  `;
}

export function getWorkbookLineageByLuid(response: unknown): Map<string, Array<LineageContent>> {
  const parsed = workbookLineageResponseSchema.parse(response);
  return new Map(
    parsed.data.workbooksConnection.nodes.map((node) => [
      node.luid,
      collectPublishedLineage(node.upstreamDatasources, node.embeddedDatasources),
    ]),
  );
}

export function getViewLineageByLuid(response: unknown): Map<string, ViewLineage> {
  const parsed = viewLineageResponseSchema.parse(response);
  const nodes = [
    ...(parsed.data.sheetsConnection?.nodes ?? []),
    ...(parsed.data.dashboardsConnection?.nodes ?? []),
  ];

  return new Map(
    nodes.map((node) => [
      node.luid,
      {
        upstreamDatasources: collectPublishedLineage(
          node.upstreamDatasources,
          node.workbook?.embeddedDatasources,
        ),
        workbook: node.workbook?.name
          ? { luid: node.workbook.luid, name: node.workbook.name }
          : undefined,
        ownerLuid: node.workbook?.owner?.luid ?? undefined,
        ownerName: node.workbook?.owner?.name ?? node.workbook?.owner?.username ?? undefined,
        projectLuid: node.workbook?.projectLuid ?? undefined,
        projectName: node.workbook?.projectName ?? undefined,
      },
    ]),
  );
}

type ViewLineage = {
  upstreamDatasources: Array<LineageContent>;
  workbook?: LineageContent;
  ownerLuid?: string;
  ownerName?: string;
  projectLuid?: string;
  projectName?: string;
};

export function mergeWorkbookLineage<T extends Pick<Workbook, 'id'> & Partial<Workbook>>(
  workbooks: Array<T>,
  lineageByLuid: Map<string, Array<LineageContent>>,
  allowedDatasourceIds?: Set<string> | null,
): Array<T> {
  return workbooks.map((workbook) => {
    const upstreamDatasources = filterLineageContentsByAllowedIds(
      lineageByLuid.get(workbook.id),
      allowedDatasourceIds,
    );
    return upstreamDatasources.length ? { ...workbook, upstreamDatasources } : workbook;
  });
}

export function mergeViewLineage<T extends Pick<View, 'id'> & Partial<View>>(
  views: Array<T>,
  lineageByLuid: Map<string, ViewLineage>,
  allowedDatasourceIds?: Set<string> | null,
): Array<T> {
  return views.map((view) => {
    const lineage = lineageByLuid.get(view.id);
    if (!lineage) {
      return view;
    }

    const upstreamDatasources = filterLineageContentsByAllowedIds(
      lineage.upstreamDatasources,
      allowedDatasourceIds,
    );

    return {
      ...view,
      ...(upstreamDatasources.length ? { upstreamDatasources } : {}),
      ...(lineage.workbook
        ? {
            workbook: {
              ...view.workbook,
              id: view.workbook?.id ?? lineage.workbook.luid,
              name: lineage.workbook.name,
            },
          }
        : {}),
      ...(lineage.ownerLuid || lineage.ownerName
        ? {
            owner: {
              ...view.owner,
              id: view.owner?.id ?? lineage.ownerLuid,
              name: lineage.ownerName,
            },
          }
        : {}),
      ...(lineage.projectLuid || lineage.projectName
        ? {
            project: {
              ...view.project,
              id: view.project?.id ?? lineage.projectLuid,
              name: lineage.projectName,
            },
          }
        : {}),
    };
  });
}

// --- Datasource downstream (reverse) lineage --------------------------------
// Used by delete-datasource to warn which workbooks / flows depend on a published
// datasource before it is deleted. This is the reverse direction of the workbook/view
// lineage above (which resolves upstream datasources).

export type DownstreamContent = {
  luid: string;
  name: string;
};

export type DatasourceDownstream = {
  workbooks: Array<DownstreamContent>;
  flows: Array<DownstreamContent>;
};

const downstreamNodeSchema = z.object({
  luid: z.string().nullable().optional(),
  name: z.string().nullable().optional(),
});

const datasourceDownstreamResponseSchema = z.object({
  data: z.object({
    publishedDatasourcesConnection: z.object({
      nodes: z.array(
        z.object({
          luid: z.string(),
          downstreamWorkbooks: z.array(downstreamNodeSchema).nullish(),
          downstreamFlows: z.array(downstreamNodeSchema).nullish(),
        }),
      ),
    }),
  }),
});

export function getDatasourceDownstreamQuery(datasourceLuids: Array<string>): string {
  return `
    query datasourceDownstream {
      publishedDatasourcesConnection(filter: { luidWithin: ${toGraphqlStringArray(datasourceLuids)} }) {
        nodes {
          luid
          downstreamWorkbooks {
            luid
            name
          }
          downstreamFlows {
            luid
            name
          }
        }
      }
    }
  `;
}

export function getDatasourceDownstreamByLuid(
  response: unknown,
): Map<string, DatasourceDownstream> {
  const parsed = datasourceDownstreamResponseSchema.parse(response);
  return new Map(
    parsed.data.publishedDatasourcesConnection.nodes.map((node) => [
      node.luid,
      {
        workbooks: normalizeDownstreamContents(node.downstreamWorkbooks),
        flows: normalizeDownstreamContents(node.downstreamFlows),
      },
    ]),
  );
}

function normalizeDownstreamContents(
  contents: Array<z.infer<typeof downstreamNodeSchema>> | null | undefined,
): Array<DownstreamContent> {
  return (contents ?? [])
    .filter((content): content is { luid: string; name?: string | null } => !!content.luid)
    .map((content) => ({ luid: content.luid, name: content.name ?? content.luid }));
}

function toGraphqlStringArray(values: Array<string>): string {
  return `[${values.map((value) => JSON.stringify(value)).join(', ')}]`;
}

// datasource.id is the VDS-queryable embedded LUID. Multi-connection datasources repeat it
// across rows, so dedupe by luid. name is optional on the wire; fall back to the luid.
export function toEmbeddedLineageContents(
  connections: Array<WorkbookConnection>,
): Array<LineageContent> {
  const byLuid = new Map<string, LineageContent>();
  for (const { datasource } of connections) {
    if (datasource && !byLuid.has(datasource.id)) {
      byLuid.set(datasource.id, {
        luid: datasource.id,
        name: datasource.name ?? datasource.id,
        datasourceType: 'embedded',
      });
    }
  }
  return [...byLuid.values()];
}

// A workbook's live connection to a published datasource surfaces twice: once as the embedded
// "sqlproxy" stub in REST /connections (whose datasource.id is the workbook's internal,
// VDS-queryable LUID) and once as the published datasource reached via the Metadata API. They are
// the same logical datasource, so we emit a single entry keyed on the connection's LUID and
// reclassify it as 'published' when a Metadata published upstream shares its name. The two LUIDs
// cannot be joined directly (the Metadata node id != the REST datasource.id), so name is the only
// available bridge. Published upstreams that no connection accounts for (e.g. the /connections call
// failed, or the names diverge) are appended with their Metadata LUID so they are not lost.
export function reconcileWorkbookDatasources(
  connectionDatasources: Array<LineageContent>,
  publishedUpstream: Array<LineageContent>,
): Array<LineageContent> {
  const publishedNames = new Set(publishedUpstream.map((ds) => ds.name));
  const connectionNames = new Set(connectionDatasources.map((ds) => ds.name));

  const reconciled: Array<LineageContent> = connectionDatasources.map((ds) => ({
    ...ds,
    datasourceType: publishedNames.has(ds.name) ? ('published' as const) : ('embedded' as const),
  }));

  for (const pub of publishedUpstream) {
    if (!connectionNames.has(pub.name)) {
      reconciled.push({ ...pub, datasourceType: 'published' as const });
    }
  }

  return reconciled;
}

// Unions the content-level upstream datasources with those reached via embedded datasources,
// drops entries without a luid (embedded datasources carry no luid), and dedupes by luid while
// preserving first-seen order. This is what recovers published datasources that the content-level
// upstreamDatasources rollup omits (see metadataEmbeddedDatasourceSchema).
function collectPublishedLineage(
  upstreamDatasources: Array<z.infer<typeof metadataLineageContentSchema>> | null | undefined,
  embeddedDatasources: Array<z.infer<typeof metadataEmbeddedDatasourceSchema>> | null | undefined,
): Array<LineageContent> {
  const combined = [
    ...(upstreamDatasources ?? []),
    ...(embeddedDatasources ?? []).flatMap((ds) => ds.upstreamDatasources ?? []),
  ];

  const byLuid = new Map<string, LineageContent>();
  for (const content of combined) {
    if (content.luid && !byLuid.has(content.luid)) {
      byLuid.set(content.luid, { luid: content.luid, name: content.name ?? content.luid });
    }
  }

  return [...byLuid.values()];
}

export function filterLineageContentsByAllowedIds(
  contents: Array<LineageContent> | undefined,
  allowedIds?: Set<string> | null,
): Array<LineageContent> {
  if (!contents?.length) {
    return [];
  }

  if (!allowedIds) {
    return contents;
  }

  return contents.filter((content) => allowedIds.has(content.luid));
}
