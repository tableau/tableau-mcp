import { Ok, Result } from 'ts-results-es';
import { z } from 'zod';

import { McpToolError } from '../../../errors/mcpToolError.js';
import { Query } from '../../../sdks/tableau/apis/vizqlDataServiceApi.js';
import { RestApi } from '../../../sdks/tableau/restApi.js';
import { ExpiringMap } from '../../../utils/expiringMap.js';
import { milliseconds } from '../../../utils/milliseconds.js';
import { paginate } from '../../../utils/paginate.js';
import { parseNumber } from '../../../utils/parseNumber.js';
import { ADMIN_INSIGHTS_PROJECT_NAME } from './resolver.js';

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

// Structured warning attached to a successful result when some requested projectIds were
// ignored. Follows the `mcp.warnings` convention established by query-datasource
// (see ContextFilterWarning in validators/validateContextFilters.ts). At most two entries
// are produced — one per `reason`.
type StaleReportWarning = {
  type: 'PROJECT_IDS_IGNORED';
  severity: 'WARNING';
  message: string;
  ignoredProjectIds: string[];
  reason: 'unknown-on-site' | 'not-permitted-by-config';
};

const MS_PER_DAY = 1000 * 60 * 60 * 24;

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
}): Promise<Result<{ names: string[]; unknownIds: string[] }, McpToolError>> {
  const idSet = new Set(projectIds);
  const cache = getProjectNameCache();

  // Cache hit: every requested ID is in the cache. An all-hit means every requested ID
  // resolved to a real project name, so there are no unknown IDs.
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
    return new Ok({ names: Array.from(cachedNames), unknownIds: [] });
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
  const matchedIds = new Set<string>();
  for (const p of projects) {
    cache.set(`${restApi.siteId}:${p.id}`, p.name);
    if (idSet.has(p.id)) {
      out.add(p.name);
      matchedIds.add(p.id);
    }
  }

  // Requested IDs that matched no site project — silently dropped before W-23202054.
  const unknownIds = projectIds.filter((id) => !matchedIds.has(id));

  return new Ok({ names: Array.from(out), unknownIds });
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

type ProjectScopeResolution = {
  // null = no scope requested (all projects the caller can access).
  scopeIds: ReadonlyArray<string> | null;
  // Requested IDs dropped because they fall outside the server INCLUDE_PROJECT_IDS bound.
  boundedOutOfScopeIds: ReadonlyArray<string>;
};

function resolveProjectScopeIds({
  argProjectIds,
  boundedProjectIds,
}: {
  argProjectIds: ReadonlyArray<string> | undefined;
  boundedProjectIds: Set<string> | null;
}): ProjectScopeResolution {
  if (argProjectIds && argProjectIds.length > 0) {
    if (boundedProjectIds) {
      return {
        scopeIds: argProjectIds.filter((id) => boundedProjectIds.has(id)),
        boundedOutOfScopeIds: argProjectIds.filter((id) => !boundedProjectIds.has(id)),
      };
    }
    return { scopeIds: [...argProjectIds], boundedOutOfScopeIds: [] };
  }
  if (boundedProjectIds) {
    return { scopeIds: Array.from(boundedProjectIds), boundedOutOfScopeIds: [] };
  }
  return { scopeIds: null, boundedOutOfScopeIds: [] };
}

// Assembles at most two structured warnings — one for IDs unknown on the site, one for IDs
// dropped by the server-configured project scope — for attachment to the successful result.
// `hasRemainingScope` branches the wording: when no requested project survived, the message must
// tell the caller the report is empty rather than implying a valid subset was scoped to — that
// false premise is exactly the silent-widening confusion this fix targets.
function buildProjectIdWarnings({
  boundedOutOfScopeIds,
  unknownProjectIds,
  hasRemainingScope,
}: {
  boundedOutOfScopeIds: ReadonlyArray<string>;
  unknownProjectIds: ReadonlyArray<string>;
  hasRemainingScope: boolean;
}): StaleReportWarning[] {
  const warnings: StaleReportWarning[] = [];
  const outcome = hasRemainingScope
    ? 'The report was scoped to the remaining valid projects.'
    : 'None of the requested projectIds resolved to a project you can report on; an empty report (0 rows) was returned instead of the full site.';

  if (unknownProjectIds.length > 0) {
    warnings.push({
      type: 'PROJECT_IDS_IGNORED',
      severity: 'WARNING',
      message:
        `The following requested projectIds do not exist on this site and were ignored: ${unknownProjectIds.join(', ')}. ` +
        outcome,
      ignoredProjectIds: [...unknownProjectIds],
      reason: 'unknown-on-site',
    });
  }

  if (boundedOutOfScopeIds.length > 0) {
    warnings.push({
      type: 'PROJECT_IDS_IGNORED',
      severity: 'WARNING',
      message:
        `The following requested projectIds are outside this server's configured project scope and were ignored: ${boundedOutOfScopeIds.join(', ')}. ` +
        outcome,
      ignoredProjectIds: [...boundedOutOfScopeIds],
      reason: 'not-permitted-by-config',
    });
  }

  return warnings;
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
  resolveProjectIdsToNames,
  buildProjectIdWarnings,
  parseSize,
};

// Exported for reuse by query-admin-insights (kind=stale-content).
export {
  buildProjectIdWarnings as _buildProjectIdWarnings,
  buildSiteContentQuery as _buildSiteContentQuery,
  resolveProjectIdsToNames as _resolveProjectIdsToNames,
  resolveProjectScopeIds as _resolveProjectScopeIds,
  siteContentRowSchema as _siteContentRowSchema,
};
export type { StaleReportWarning as _StaleReportWarning };
