import { z } from 'zod';

import { View } from '../types/view.js';
import { Workbook } from '../types/workbook.js';

export type LineageContent = {
  luid: string;
  name: string;
};

const lineageContentSchema = z.object({
  luid: z.string().optional(),
  name: z.string().nullable().optional(),
});

const workbookLineageResponseSchema = z.object({
  data: z.object({
    workbooksConnection: z.object({
      nodes: z.array(
        z.object({
          luid: z.string(),
          upstreamDatasources: z.array(lineageContentSchema).nullish(),
        }),
      ),
    }),
  }),
});

const viewLineageResponseSchema = z.object({
  data: z.object({
    sheetsConnection: z.object({
      nodes: z.array(
        z.object({
          luid: z.string(),
          upstreamDatasources: z.array(lineageContentSchema).nullish(),
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
        }),
      ),
    }),
  }),
});

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
        }
      }
    }
  `;
}

export function getViewLineageQuery(viewLuids: Array<string>): string {
  return `
    query viewLineage {
      sheetsConnection(filter: { luidWithin: ${toGraphqlStringArray(viewLuids)} }) {
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
      }
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
          ? `sheetsConnection(filter: { luidWithin: ${toGraphqlStringArray(viewLuids)} }) {
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
      }`
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

export function getViewLineageByLuid(response: unknown): Map<string, ViewLineage> {
  const parsed = viewLineageResponseSchema.parse(response);
  return new Map(
    parsed.data.sheetsConnection.nodes.map((node) => [
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

function normalizeLineageContents(
  contents: Array<z.infer<typeof lineageContentSchema>> | null | undefined,
): Array<LineageContent> {
  return (contents ?? [])
    .filter((content): content is { luid: string; name?: string | null } => !!content.luid)
    .map((content) => ({ luid: content.luid, name: content.name ?? content.luid }));
}

function filterLineageContentsByAllowedIds(
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
