import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok, Result } from 'ts-results-es';
import { z } from 'zod';

import { getConfig } from '../../../config.js';
import { AdminOnlyError, McpToolError } from '../../../errors/mcpToolError.js';
import { useRestApi } from '../../../restApiInstance.js';
import { Query } from '../../../sdks/tableau/apis/vizqlDataServiceApi.js';
import { RestApi } from '../../../sdks/tableau/restApi.js';
import { WebMcpServer } from '../../../server.web.js';
import { ExpiringMap } from '../../../utils/expiringMap.js';
import { milliseconds } from '../../../utils/milliseconds.js';
import { paginate } from '../../../utils/paginate.js';
import { parseNumber } from '../../../utils/parseNumber.js';
import { assertAdmin } from '../adminGate.js';
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
      'Minimum days since last access for content to be considered stale. Defaults to 90 days.',
    ),
  projectIds: z
    .array(z.string())
    .optional()
    .describe(
      'Optional list of project LUIDs to scope the report to. ' +
        'If omitted, returns all projects the caller can access.',
    ),
  itemTypes: z
    .array(z.enum(['Workbook', 'Datasource']))
    .optional()
    .describe('Optional filter for item types. Defaults to ["Workbook", "Datasource"].'),
};

export type StaleContentRow = {
  itemId: string;
  // The content LUID (UUID) — the identifier delete-workbook/get-workbook/delete-datasource require.
  // Distinct from itemId, which is Site Content's integer repository ID and is NOT accepted by REST.
  // Null only when the Site Content datasource omits the Item LUID column (older schemas).
  itemLuid: string | null;
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

// Schema for the row shape returned by the Admin Insights "Site Content" datasource.
// VDS returns Item ID as a number (integer) on Site Content, not a string. All fields are
// optional because the datasource may omit columns that were not explicitly selected.
// `.passthrough()` keeps any additional keys VDS might add without rejecting the row.
const siteContentRowSchema = z
  .object({
    'Item ID': z.union([z.string(), z.number()]).nullable().optional(),
    'Item LUID': z.string().nullable().optional(),
    'Item Type': z.string().nullable().optional(),
    'Item Name': z.string().nullable().optional(),
    'Item Parent Project Name': z.string().nullable().optional(),
    'Owner Email': z.string().nullable().optional(),
    'Created At': z.string().nullable().optional(),
    'Updated At': z.string().nullable().optional(),
    'Last Accessed At': z.string().nullable().optional(),
    'Size (bytes)': z.union([z.number(), z.string()]).nullable().optional(),
  })
  .passthrough();

type SiteContentRow = z.infer<typeof siteContentRowSchema>;

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
      "itemLuid": "..." | null,
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

To act on a stale item (e.g. \`delete-workbook\`, \`get-workbook\`, \`delete-datasource\`), pass
\`itemLuid\` — the content LUID. Do NOT pass \`itemId\`: it is Site Content's integer repository ID
and the REST API rejects it (404). \`itemLuid\` is \`null\` only on older sites that omit the column.

**Caveats**
- The Tableau-managed \`Admin Insights\` project is excluded by design — its datasources
  are admin-owned and not user content.
- \`Last Accessed At\` is \`null\` for items that have never been accessed; the report
  ages those items from \`Created At\` instead.
`.trim(),
    paramsSchema,
    annotations: {
      title: 'Stale content report',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
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
              const adminResult = await assertAdmin(restApi, extra);
              if (adminResult.isErr()) {
                return new AdminOnlyError(adminResult.error).toErr();
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

              const universe = z
                .array(siteContentRowSchema)
                .parse(siteContentResult.value.data ?? []);

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
  ];

  // VDS rejects multiple SET filters on the same field (e.g. one exclude + one include
  // on Item Parent Project Name). When a project scope is provided, send only the
  // include filter — Admin Insights exclusion is then enforced client-side in
  // computeStaleRows. Otherwise send the exclude filter so the smaller payload
  // is transferred from VDS.
  if (projectNameScope && projectNameScope.length > 0) {
    filters.push({
      field: { fieldCaption: 'Item Parent Project Name' },
      filterType: 'SET',
      values: [...projectNameScope],
      exclude: false,
    });
  } else {
    filters.push({
      field: { fieldCaption: 'Item Parent Project Name' },
      filterType: 'SET',
      values: [ADMIN_INSIGHTS_PROJECT_NAME],
      exclude: true,
    });
  }

  return {
    fields: [
      { fieldCaption: 'Item ID' },
      { fieldCaption: 'Item LUID' },
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
  const cache = getProjectNameCache();

  // Cache hit: every requested ID is in the cache.
  const cachedNames = new Set<string>();
  let allHit = true;
  for (const id of idSet) {
    const name = cache.get(`${restApi.siteId}:${id}`);
    if (name === undefined) {
      allHit = false;
      break;
    }
    cachedNames.add(name);
  }
  if (allHit) {
    return new Ok(Array.from(cachedNames));
  }

  // Cache miss for at least one ID: refresh the full project list for this site.
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

  const out = new Set<string>();
  for (const p of projects) {
    cache.set(`${restApi.siteId}:${p.id}`, p.name);
    if (idSet.has(p.id)) {
      out.add(p.name);
    }
  }

  return new Ok(Array.from(out));
}

// Lazy-initialized cache to avoid module-level parseNumber call.
// Mirrors the pattern in `adminGate.ts`: ExpiringMap with env-var-configurable TTL,
// keyed by `${siteId}:${projectId}` -> project name. Full optimization
// (size limits, eviction policy, telemetry) tracked in W-22551424.
let projectNameCache: ExpiringMap<string, string> | null = null;

function getProjectNameCache(): ExpiringMap<string, string> {
  if (!projectNameCache) {
    // Reuses ADMIN_GATE_CACHE_TTL_MINUTES — single knob for all admin-tools caches.
    const ttlMinutes = parseNumber(process.env.ADMIN_GATE_CACHE_TTL_MINUTES, {
      defaultValue: 5,
      minValue: 1,
      maxValue: 60 * 24, // 24 hours
    });
    projectNameCache = new ExpiringMap<string, string>({
      defaultExpirationTimeMs: milliseconds.fromMinutes(ttlMinutes),
    });
  }
  return projectNameCache;
}

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

    // Belt-and-suspenders client-side exclusion of the Tableau-managed Admin Insights
    // project. The VDS query already excludes it when no projectNameScope is set, but
    // when scope is set we cannot stack a second SET filter on the same field — so the
    // exclusion must happen here.
    if (row['Item Parent Project Name'] === ADMIN_INSIGHTS_PROJECT_NAME) {
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
      itemLuid: typeof row['Item LUID'] === 'string' ? row['Item LUID'] : null,
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
  projectNameCache?.clear();
  projectNameCache = null;
}

export const exportedForTesting = {
  buildSiteContentQuery,
  resolveProjectScopeIds,
  parseSize,
};
