import { z } from 'zod';

import { LineageContent, PublishedParent } from '../types/lineageContent.js';
import { View } from '../types/view.js';
import { Workbook, WorkbookConnection } from '../types/workbook.js';

export type { LineageContent, PublishedParent };

// Lenient wire-parse schema for Metadata-API GraphQL responses: luid is absent for embedded
// datasources and name can be null, so both are optional here. normalizeLineageContents drops
// entries without a luid before producing the strict LineageContent output shape.
const metadataLineageContentSchema = z.object({
  luid: z.string().optional(),
  name: z.string().nullable().optional(),
});

// Metadata-API embedded datasource: name is the only join key shared with the REST /connections
// LUID (the Metadata EmbeddedDatasource.id is an unqueryable hash). parentPublishedDatasources is
// the authoritative published-parent linkage.
const metadataEmbeddedDatasourceSchema = z.object({
  name: z.string().nullable().optional(),
  parentPublishedDatasources: z
    .array(
      z.object({
        luid: z.string().nullable().optional(),
        name: z.string().nullable().optional(),
      }),
    )
    .nullish(),
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
          }
        }
      }`;
}

export function getWorkbookLineageQuery(workbookLuids: Array<string>): string {
  return `
    query workbookLineage {
      workbooksConnection(filter: { luidWithin: ${toGraphqlStringArray(workbookLuids)} }) {
        nodes {
          luid
          upstreamDatasources {
            luid
            name
          }
          embeddedDatasources {
            name
            parentPublishedDatasources {
              luid
              name
            }
          }
        }
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
        nodes {
          luid
          upstreamDatasources {
            luid
            name
          }
        }
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
      normalizeLineageContents(node.upstreamDatasources),
    ]),
  );
}

// Authoritative embedded-datasource -> published-parent map, keyed by embedded datasource name (the
// join key we can correlate against the REST /connections LUID). Names with anything other than
// exactly one identifiable parent are omitted: a duplicated embedded name makes the name->LUID join
// ambiguous, and multiple/zero parentPublishedDatasources cannot be represented as one publishedParent.
// Omitting is deliberate (R5) — an embedded entry with no authoritative parent is emitted standalone.
export function getWorkbookEmbeddedParentsByLuid(
  response: unknown,
): Map<string, Map<string, PublishedParent>> {
  const parsed = workbookLineageResponseSchema.parse(response);
  return new Map(
    parsed.data.workbooksConnection.nodes.map((node) => [
      node.luid,
      buildEmbeddedParentMap(node.embeddedDatasources),
    ]),
  );
}

function buildEmbeddedParentMap(
  embeddedDatasources: Array<z.infer<typeof metadataEmbeddedDatasourceSchema>> | null | undefined,
): Map<string, PublishedParent> {
  const parents = new Map<string, PublishedParent>();
  const seenNames = new Set<string>();

  for (const { name, parentPublishedDatasources } of embeddedDatasources ?? []) {
    if (!name) {
      continue;
    }
    if (seenNames.has(name)) {
      // Duplicate embedded name -> the name->LUID join is ambiguous. Drop it entirely.
      parents.delete(name);
      continue;
    }
    seenNames.add(name);

    const validParents = (parentPublishedDatasources ?? []).filter(
      (parent): parent is { luid: string; name?: string | null } => !!parent.luid,
    );
    if (validParents.length === 1) {
      const parent = validParents[0];
      parents.set(name, { luid: parent.luid, name: parent.name ?? parent.luid });
    }
  }

  return parents;
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
        upstreamDatasources: normalizeLineageContents(node.upstreamDatasources),
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
// When parentByName is supplied (authoritative Metadata linkage keyed by embedded name), attach a
// publishedParent pointer — but only when the name maps to a single embedded LUID here, since the
// name is the join key and a duplicated name would attach the parent to the wrong LUID (R5).
export function toEmbeddedLineageContents(
  connections: Array<WorkbookConnection>,
  parentByName?: Map<string, PublishedParent>,
): Array<LineageContent> {
  const byLuid = new Map<string, LineageContent>();
  const nameCounts = new Map<string, number>();
  for (const { datasource } of connections) {
    if (datasource && !byLuid.has(datasource.id)) {
      const name = datasource.name ?? datasource.id;
      byLuid.set(datasource.id, { luid: datasource.id, name, datasourceType: 'embedded' });
      nameCounts.set(name, (nameCounts.get(name) ?? 0) + 1);
    }
  }

  if (!parentByName?.size) {
    return [...byLuid.values()];
  }

  return [...byLuid.values()].map((entry) => {
    if ((nameCounts.get(entry.name) ?? 0) > 1) {
      return entry; // ambiguous name->LUID join; emit standalone.
    }
    const publishedParent = parentByName.get(entry.name);
    return publishedParent ? { ...entry, publishedParent } : entry;
  });
}

function normalizeLineageContents(
  contents: Array<z.infer<typeof metadataLineageContentSchema>> | null | undefined,
): Array<LineageContent> {
  return (contents ?? [])
    .filter((content): content is { luid: string; name?: string | null } => !!content.luid)
    .map((content) => ({ luid: content.luid, name: content.name ?? content.luid }));
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
