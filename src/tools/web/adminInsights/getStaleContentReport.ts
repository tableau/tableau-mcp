import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { getConfig } from '../../../config.js';
import { AdminOnlyError } from '../../../errors/mcpToolError.js';
import { adminGate, NotAdminError } from '../../../prompts/_lib/adminGate.js';
import { useRestApi } from '../../../restApiInstance.js';
import { Query } from '../../../sdks/tableau/apis/vizqlDataServiceApi.js';
import { WebMcpServer } from '../../../server.web.js';
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
      'Optional list of project LUIDs to scope the report to. ' +
        'If omitted, falls back to the server-configured INCLUDE_PROJECT_IDS bound (if any).',
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

type TsEventsRow = Record<string, unknown> & {
  'Item ID'?: string;
  'Item Type'?: string;
  last_access?: string;
};

type SiteContentRow = Record<string, unknown> & {
  'Item ID'?: string;
  'Item Type'?: string;
  'Item Name'?: string;
  Project?: string;
  'Project ID'?: string;
  'Owner Email'?: string;
  'Created At'?: string;
  'Updated At'?: string;
  Size?: number | string;
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
datasources) by anti-joining the Admin Insights "TS Events" (last access) and "Site Content"
(item universe) datasources, applying the staleness threshold server-side, and returning
already-filtered rows. Restricted to Tableau site administrators on Tableau Cloud sites with
Admin Insights enabled.

The server performs the join, threshold comparison, optional project filter, and sort —
clients receive only items where days since last use exceed the threshold. No client-side
math is required.

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

Rows are sorted descending by \`daysSinceLastUse\`, then by \`size\`. Items with no Access
events in the lookback window have \`lastUsedDate = createdAt\` and \`neverAccessed = true\`.

**Caveats**
- Tableau Cloud TS Events lookback caps at 90 days (365 days with Advanced Management).
  Items beyond the cap cannot be distinguished from each other on \`daysSinceLastUse\`.
- Only \`Access\` events are considered "use". Refresh-only datasources will look stale
  even if they are being refreshed nightly.
- The Tableau-managed \`Admin Insights\` project is excluded by design — its
  datasources are admin-owned and not user content.
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
      const projectScope = resolveProjectScope({
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

              const tsEventsResult = await executeAdminInsightsQuery({
                restApi,
                datasetName: ADMIN_INSIGHTS_DATASETS.TS_EVENTS,
                query: buildTsEventsQuery(types),
              });
              if (tsEventsResult.isErr()) {
                return tsEventsResult;
              }

              const siteContentResult = await executeAdminInsightsQuery({
                restApi,
                datasetName: ADMIN_INSIGHTS_DATASETS.SITE_CONTENT,
                query: buildSiteContentQuery(types),
              });
              if (siteContentResult.isErr()) {
                return siteContentResult;
              }

              const lastAccess = indexLastAccess(
                (tsEventsResult.value.data ?? []) as TsEventsRow[],
              );
              const universe = (siteContentResult.value.data ?? []) as SiteContentRow[];

              const today = new Date();
              const rows = computeStaleRows({
                universe,
                lastAccess,
                thresholdDays,
                projectScope,
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

function buildTsEventsQuery(types: ReadonlyArray<'Workbook' | 'Datasource'>): Query {
  return {
    fields: [
      { fieldCaption: 'Item ID' },
      { fieldCaption: 'Item Type' },
      {
        fieldCaption: 'Event Date (UTC)',
        function: 'MAX',
        fieldAlias: 'last_access',
      },
    ],
    filters: [
      {
        field: { fieldCaption: 'Event Type' },
        filterType: 'SET',
        values: ['Access'],
        exclude: false,
      },
      {
        field: { fieldCaption: 'Item Type' },
        filterType: 'SET',
        values: [...types],
        exclude: false,
      },
    ],
  };
}

function buildSiteContentQuery(types: ReadonlyArray<'Workbook' | 'Datasource'>): Query {
  return {
    fields: [
      { fieldCaption: 'Item ID' },
      { fieldCaption: 'Item Type' },
      { fieldCaption: 'Item Name' },
      { fieldCaption: 'Project' },
      { fieldCaption: 'Project ID' },
      { fieldCaption: 'Owner Email' },
      { fieldCaption: 'Created At' },
      { fieldCaption: 'Updated At' },
      { fieldCaption: 'Size' },
    ],
    filters: [
      {
        field: { fieldCaption: 'Item Type' },
        filterType: 'SET',
        values: [...types],
        exclude: false,
      },
      // Exclude the Tableau-managed Admin Insights project — its datasources are
      // admin-owned, refreshed by Tableau, and not user content.
      {
        field: { fieldCaption: 'Project' },
        filterType: 'SET',
        values: [ADMIN_INSIGHTS_PROJECT_NAME],
        exclude: true,
      },
    ],
  };
}

function indexLastAccess(rows: ReadonlyArray<TsEventsRow>): Map<string, string> {
  const map = new Map<string, string>();
  for (const row of rows) {
    const itemId = row['Item ID'];
    const itemType = row['Item Type'];
    const lastAccess = row.last_access;
    if (
      typeof itemId === 'string' &&
      typeof itemType === 'string' &&
      typeof lastAccess === 'string'
    ) {
      map.set(`${itemType}:${itemId}`, lastAccess);
    }
  }
  return map;
}

type ProjectScope = { mode: 'all' } | { mode: 'restricted'; ids: Set<string> };

function resolveProjectScope({
  argProjectIds,
  boundedProjectIds,
}: {
  argProjectIds: ReadonlyArray<string> | undefined;
  boundedProjectIds: Set<string> | null;
}): ProjectScope {
  if (argProjectIds && argProjectIds.length > 0) {
    if (boundedProjectIds) {
      const intersection = new Set(argProjectIds.filter((id) => boundedProjectIds.has(id)));
      return { mode: 'restricted', ids: intersection };
    }
    return { mode: 'restricted', ids: new Set(argProjectIds) };
  }
  if (boundedProjectIds) {
    return { mode: 'restricted', ids: boundedProjectIds };
  }
  return { mode: 'all' };
}

export function computeStaleRows({
  universe,
  lastAccess,
  thresholdDays,
  projectScope,
  today,
}: {
  universe: ReadonlyArray<SiteContentRow>;
  lastAccess: Map<string, string>;
  thresholdDays: number;
  projectScope: ProjectScope;
  today: Date;
}): StaleContentRow[] {
  const todayMs = today.getTime();
  const out: StaleContentRow[] = [];

  for (const row of universe) {
    const itemId = row['Item ID'];
    const itemType = row['Item Type'];
    const itemName = row['Item Name'];
    if (
      typeof itemId !== 'string' ||
      typeof itemType !== 'string' ||
      typeof itemName !== 'string'
    ) {
      continue;
    }

    if (projectScope.mode === 'restricted') {
      const projectId = row['Project ID'];
      if (typeof projectId !== 'string' || !projectScope.ids.has(projectId)) {
        continue;
      }
    }

    const accessKey = `${itemType}:${itemId}`;
    const lastAccessStr = lastAccess.get(accessKey);
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
      project: typeof row.Project === 'string' ? row.Project : null,
      ownerEmail: typeof row['Owner Email'] === 'string' ? row['Owner Email'] : null,
      createdAt,
      updatedAt: typeof row['Updated At'] === 'string' ? row['Updated At'] : null,
      lastUsedDate: lastUsedStr,
      daysSinceLastUse,
      size: parseSize(row.Size),
      neverAccessed: lastAccessStr === undefined,
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

export const exportedForTesting = {
  buildTsEventsQuery,
  buildSiteContentQuery,
  indexLastAccess,
  resolveProjectScope,
  parseSize,
};
