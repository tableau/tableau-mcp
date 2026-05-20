import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok, Result } from 'ts-results-es';
import { z } from 'zod';

import { getConfig } from '../../../config.js';
import { AdminOnlyError, McpToolError } from '../../../errors/mcpToolError.js';
import { adminGate, NotAdminError } from '../../../prompts/_lib/adminGate.js';
import { useRestApi } from '../../../restApiInstance.js';
import { Query } from '../../../sdks/tableau/apis/vizqlDataServiceApi.js';
import { RestApi } from '../../../sdks/tableau/restApi.js';
import { WebMcpServer } from '../../../server.web.js';
import { paginate } from '../../../utils/paginate.js';
import { WebTool } from '../tool.js';
import { executeAdminInsightsQuery } from './adminInsightsToolBase.js';
import { ADMIN_INSIGHTS_DATASETS, ADMIN_INSIGHTS_PROJECT_NAME } from './resolver.js';

const paramsSchema = {
  minAgeDays: z
    .number()
    .int()
    .min(1)
    .max(3650)
    .optional()
    .describe(
      'Minimum days since last access for content to be considered stale. ' +
        'Defaults to the server-configured threshold (STALE_CONTENT_MIN_AGE_DAYS, default 90).',
    ),
  projectIds: z
    .array(z.string())
    .optional()
    .describe(
      'Optional list of project LUIDs to scope the report to. The server resolves the LUIDs ' +
        'to project names via the Tableau REST API and filters the Site Content datasource by ' +
        'parent project name. If omitted, falls back to the server-configured INCLUDE_PROJECT_IDS ' +
        'bound (if any).',
    ),
  itemTypes: z
    .array(z.enum(['Workbook', 'Datasource']))
    .optional()
    .describe('Optional filter for item types. Defaults to ["Workbook", "Datasource"].'),
};

export type StaleContentRow = {
  itemId: string;
  itemType: string;
  itemName: string;
  project: string | null;
  ownerEmail: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  lastUsedDate: string;
  daysSinceLastUse: number;
  size: number | null;
  neverAccessed: boolean;
};

type SiteContentRow = Record<string, unknown> & {
  // VDS returns Item ID as a number on Site Content (integer), not a string.
  'Item ID'?: string | number;
  'Item Type'?: string;
  'Item Name'?: string;
  'Item Parent Project Name'?: string;
  'Owner Email'?: string;
  'Created At'?: string;
  'Updated At'?: string;
  'Last Accessed At'?: string | null;
  'Size (bytes)'?: number | string;
};

const MS_PER_DAY = 1000 * 60 * 60 * 24;

export const getGetStaleContentReportTool = (
  server: WebMcpServer,
): WebTool<typeof paramsSchema> => {
  const config = getConfig();
  const tool = new WebTool({
    server,
    name: 'get-stale-content-report',
    disabled: !config.adminToolsEnabled,
    description: `
Builds a deterministic report of stale Tableau Cloud content (workbooks and published
datasources) by querying the Admin Insights "Site Content" datasource — which exposes a
\`Last Accessed At\` field per item — applying the staleness threshold server-side, and
returning already-filtered rows. Restricted to Tableau site administrators on Tableau Cloud
sites with Admin Insights enabled.

The server applies the threshold comparison, optional project filter, and sort. Clients
receive only items where days since last use exceed the threshold. No client-side math.

**Output schema (JSON):**
\`\`\`json
{
  "thresholdDays": 90,
  "totalStaleItems": <number>,
  "totalStaleSizeBytes": <number>,
  "rows": [
    {
      "itemId": "...",
      "itemType": "Workbook" | "Datasource",
      "itemName": "...",
      "project": "..." | null,
      "ownerEmail": "..." | null,
      "createdAt": "ISO date" | null,
      "updatedAt": "ISO date" | null,
      "lastUsedDate": "ISO date",
      "daysSinceLastUse": <number>,
      "size": <number> | null,
      "neverAccessed": <boolean>
    }
  ]
}
\`\`\`

Rows are sorted descending by \`daysSinceLastUse\`, then by \`size\`. Items with no recorded
access have \`lastUsedDate = createdAt\` and \`neverAccessed = true\`.

**Caveats**
- The Tableau-managed \`Admin Insights\` project is excluded by design — its datasources
  are admin-owned and not user content.
- \`Last Accessed At\` is \`null\` for items that have never been accessed; the report
  ages those items from \`Created At\` instead.
- When \`projectIds\` is set (or \`INCLUDE_PROJECT_IDS\` is configured), the server resolves
  LUIDs to project names via a Tableau REST list-projects call.
`.trim(),
    paramsSchema,
    annotations: {
      title: 'Stale content report',
      readOnlyHint: true,
      openWorldHint: false,
    },
    callback: async ({ minAgeDays, projectIds, itemTypes }, extra): Promise<CallToolResult> => {
      const configWithOverrides = await extra.getConfigWithOverrides();
      const thresholdDays = minAgeDays ?? configWithOverrides.staleContentMinAgeDays;
      const types = itemTypes ?? ['Workbook', 'Datasource'];
      const requestedProjectIds = resolveProjectScopeIds({
        argProjectIds: projectIds,
        boundedProjectIds: configWithOverrides.boundedContext.projectIds,
      });

      return await tool.logAndExecute({
        extra,
        args: { minAgeDays: thresholdDays, projectIds, itemTypes: types },
        callback: async () => {
          return await useRestApi({
            ...extra,
            jwtScopes: tool.requiredApiScopes,
            callback: async (restApi) => {
              try {
                await adminGate.assertAdmin(restApi);
              } catch (error) {
                if (error instanceof NotAdminError) {
                  return new AdminOnlyError(error.message).toErr();
                }
                throw error;
              }

              let projectNameScope: ReadonlyArray<string> | null = null;
              if (requestedProjectIds) {
                const namesResult = await resolveProjectIdsToNames({
                  restApi,
                  projectIds: requestedProjectIds,
                });
                if (namesResult.isErr()) {
                  return namesResult;
                }
                projectNameScope = namesResult.value;
              }

              const siteContentResult = await executeAdminInsightsQuery({
                restApi,
                datasetName: ADMIN_INSIGHTS_DATASETS.SITE_CONTENT,
                query: buildSiteContentQuery(types, projectNameScope),
              });
              if (siteContentResult.isErr()) {
                return siteContentResult;
              }

              const universe = (siteContentResult.value.data ?? []) as SiteContentRow[];

              const today = new Date();
              const rows = computeStaleRows({
                universe,
                thresholdDays,
                today,
              });

              return new Ok({
                thresholdDays,
                totalStaleItems: rows.length,
                totalStaleSizeBytes: rows.reduce((sum, r) => sum + (r.size ?? 0), 0),
                rows,
              });
            },
          });
        },
        constrainSuccessResult: (result) => ({ type: 'success', result }),
      });
    },
  });

  return tool;
};

function buildSiteContentQuery(
  types: ReadonlyArray<'Workbook' | 'Datasource'>,
  projectNameScope: ReadonlyArray<string> | null,
): Query {
  const filters: Query['filters'] = [
    {
      field: { fieldCaption: 'Item Type' },
      filterType: 'SET',
      values: [...types],
      exclude: false,
    },
    // Exclude the Tableau-managed Admin Insights project — its datasources are
    // admin-owned, refreshed by Tableau, and not user content.
    {
      field: { fieldCaption: 'Item Parent Project Name' },
      filterType: 'SET',
      values: [ADMIN_INSIGHTS_PROJECT_NAME],
      exclude: true,
    },
  ];

  if (projectNameScope && projectNameScope.length > 0) {
    filters.push({
      field: { fieldCaption: 'Item Parent Project Name' },
      filterType: 'SET',
      values: [...projectNameScope],
      exclude: false,
    });
  }

  return {
    fields: [
      { fieldCaption: 'Item ID' },
      { fieldCaption: 'Item Type' },
      { fieldCaption: 'Item Name' },
      { fieldCaption: 'Item Parent Project Name' },
      { fieldCaption: 'Owner Email' },
      { fieldCaption: 'Created At' },
      { fieldCaption: 'Updated At' },
      { fieldCaption: 'Last Accessed At' },
      { fieldCaption: 'Size (bytes)' },
    ],
    filters,
  };
}

/**
 * Resolves project LUIDs → project names via the Tableau REST API. Cached per (siteId).
 *
 * Site Content does not expose a project LUID field — only `Item Parent Project Name`.
 * The tool's public contract takes `projectIds` (LUIDs) for parity with INCLUDE_PROJECT_IDS,
 * so we resolve LUIDs to names before passing to the VDS filter.
 */
async function resolveProjectIdsToNames({
  restApi,
  projectIds,
}: {
  restApi: RestApi;
  projectIds: ReadonlyArray<string>;
}): Promise<Result<string[], McpToolError>> {
  const idSet = new Set(projectIds);
  const cache = projectNameCache.get(restApi.siteId);
  const now = Date.now();
  if (cache && cache.expiresAt > now) {
    return new Ok(filterAndDedupe(cache.byId, idSet));
  }

  const projects = await paginate({
    pageConfig: { pageSize: 1000 },
    getDataFn: async (pageConfig) => {
      const { pagination, projects: data } = await restApi.projectsMethods.queryProjects({
        siteId: restApi.siteId,
        filter: '',
        pageSize: pageConfig.pageSize,
        pageNumber: pageConfig.pageNumber,
      });
      return { pagination, data };
    },
  });

  const byId = new Map<string, string>();
  for (const p of projects) {
    byId.set(p.id, p.name);
  }
  projectNameCache.set(restApi.siteId, { byId, expiresAt: now + PROJECT_NAME_CACHE_TTL_MS });

  return new Ok(filterAndDedupe(byId, idSet));
}

function filterAndDedupe(byId: Map<string, string>, idSet: ReadonlySet<string>): string[] {
  const out = new Set<string>();
  for (const id of idSet) {
    const name = byId.get(id);
    if (name) {
      out.add(name);
    }
  }
  return Array.from(out);
}

const PROJECT_NAME_CACHE_TTL_MS = 5 * 60 * 1000;
const projectNameCache: Map<string, { byId: Map<string, string>; expiresAt: number }> = new Map();

function resolveProjectScopeIds({
  argProjectIds,
  boundedProjectIds,
}: {
  argProjectIds: ReadonlyArray<string> | undefined;
  boundedProjectIds: Set<string> | null;
}): ReadonlyArray<string> | null {
  if (argProjectIds && argProjectIds.length > 0) {
    if (boundedProjectIds) {
      return argProjectIds.filter((id) => boundedProjectIds.has(id));
    }
    return [...argProjectIds];
  }
  if (boundedProjectIds) {
    return Array.from(boundedProjectIds);
  }
  return null;
}

export function computeStaleRows({
  universe,
  thresholdDays,
  today,
}: {
  universe: ReadonlyArray<SiteContentRow>;
  thresholdDays: number;
  today: Date;
}): StaleContentRow[] {
  const todayMs = today.getTime();
  const out: StaleContentRow[] = [];

  for (const row of universe) {
    const rawItemId = row['Item ID'];
    const itemId =
      typeof rawItemId === 'string'
        ? rawItemId
        : typeof rawItemId === 'number' && Number.isFinite(rawItemId)
          ? String(rawItemId)
          : null;
    const itemType = row['Item Type'];
    const itemName = row['Item Name'];
    if (itemId === null || typeof itemType !== 'string' || typeof itemName !== 'string') {
      continue;
    }

    const lastAccessStr =
      typeof row['Last Accessed At'] === 'string' ? row['Last Accessed At'] : null;
    const createdAt = typeof row['Created At'] === 'string' ? row['Created At'] : null;
    const lastUsedStr = lastAccessStr ?? createdAt;
    if (!lastUsedStr) {
      continue;
    }

    const lastUsedMs = Date.parse(lastUsedStr);
    if (Number.isNaN(lastUsedMs)) {
      continue;
    }

    const daysSinceLastUse = Math.floor((todayMs - lastUsedMs) / MS_PER_DAY);
    if (daysSinceLastUse <= thresholdDays) {
      continue;
    }

    out.push({
      itemId,
      itemType,
      itemName,
      project:
        typeof row['Item Parent Project Name'] === 'string'
          ? row['Item Parent Project Name']
          : null,
      ownerEmail: typeof row['Owner Email'] === 'string' ? row['Owner Email'] : null,
      createdAt,
      updatedAt: typeof row['Updated At'] === 'string' ? row['Updated At'] : null,
      lastUsedDate: lastUsedStr,
      daysSinceLastUse,
      size: parseSize(row['Size (bytes)']),
      neverAccessed: lastAccessStr === null,
    });
  }

  out.sort((a, b) => {
    if (b.daysSinceLastUse !== a.daysSinceLastUse) {
      return b.daysSinceLastUse - a.daysSinceLastUse;
    }
    return (b.size ?? 0) - (a.size ?? 0);
  });

  return out;
}

function parseSize(raw: unknown): number | null {
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? raw : null;
  }
  if (typeof raw === 'string') {
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function clearStaleContentReportCache(): void {
  projectNameCache.clear();
}

export const exportedForTesting = {
  buildSiteContentQuery,
  resolveProjectScopeIds,
  parseSize,
};
