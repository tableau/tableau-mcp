import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { getConfig } from '../../../config.js';
import { AdminOnlyError, ArgsValidationError } from '../../../errors/mcpToolError.js';
import { useRestApi } from '../../../restApiInstance.js';
import { querySchema } from '../../../sdks/tableau/apis/vizqlDataServiceApi.js';
import { WebMcpServer } from '../../../server.web.js';
import { assertAdmin } from '../adminGate.js';
import { WebTool } from '../tool.js';
import { WebToolName } from '../toolName.js';
import { executeAdminInsightsQuery, runAdminInsightsQuery } from './adminInsightsToolBase.js';
import {
  _buildSiteContentQuery,
  _resolveProjectIdsToNames,
  _resolveProjectScopeIds,
  _siteContentRowSchema,
  computeStaleRows,
  StaleContentRow,
} from './getStaleContentReport.js';
import { ADMIN_INSIGHTS_DATASETS, AdminInsightsDataset } from './resolver.js';

/**
 * Consolidated admin-insights tool (W-23375797). Dispatches on `kind` to one of four backends:
 *
 * - `ts-events` — raw VDS query against the "TS Events" datasource
 * - `site-content` — raw VDS query against the "Site Content" datasource
 * - `job-performance` — raw VDS query against the "Job Performance" datasource
 * - `stale-content` — server-side anti-join that returns already-filtered stale rows
 *
 * This is a superset of the four legacy admin-insights tools it replaces
 * (`query-admin-insights-ts-events`, `query-admin-insights-site-content`,
 * `query-admin-insights-job-performance`, `get-stale-content-report`), which remain registered as
 * additive back-compat shims for one release cycle and share the underlying implementation.
 */

const kindSchema = z.enum(['ts-events', 'site-content', 'job-performance', 'stale-content']);
type Kind = z.infer<typeof kindSchema>;

const paramsSchema = {
  kind: kindSchema.describe(
    'Which admin-insights backend to query. Use "ts-events", "site-content", or "job-performance" ' +
      'for raw VDS queries; use "stale-content" for the deterministic stale-content anti-join.',
  ),
  query: querySchema
    .optional()
    .describe(
      'VDS query object (fields, filters, parameters). REQUIRED when kind is "ts-events", ' +
        '"site-content", or "job-performance"; IGNORED when kind is "stale-content".',
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe(
      'Optional row limit. Applied when kind is "ts-events", "site-content", or ' +
        '"job-performance"; IGNORED when kind is "stale-content".',
    ),
  minAgeDays: z
    .number()
    .int()
    .min(1)
    .max(3650)
    .optional()
    .describe(
      'For kind="stale-content" only: minimum days since last access for content to be considered ' +
        'stale. Defaults to 90 days.',
    ),
  projectIds: z
    .array(z.string())
    .optional()
    .describe(
      'For kind="stale-content" only: optional list of project LUIDs to scope the report to. ' +
        'If omitted, returns all projects the caller can access.',
    ),
  itemTypes: z
    .array(z.enum(['Workbook', 'Datasource']))
    .optional()
    .describe(
      'For kind="stale-content" only: optional filter for item types. ' +
        'Defaults to ["Workbook", "Datasource"].',
    ),
};

type StaleContentResult = {
  thresholdDays: number;
  totalStaleItems: number;
  totalStaleSizeBytes: number;
  rows: StaleContentRow[];
};

export const getQueryAdminInsightsTool = (server: WebMcpServer): WebTool<typeof paramsSchema> => {
  const config = getConfig();
  const tool = new WebTool({
    server,
    name: 'query-admin-insights',
    disabled: !config.adminToolsEnabled,
    description: `
Queries the Tableau Admin Insights datasources on the current site. Restricted to Tableau site
administrators on Tableau Cloud sites with Admin Insights enabled.

Dispatches on the required \`kind\` parameter:

- **\`ts-events\`** — Raw VDS query against the "TS Events" published datasource (access events,
  publishes, sign-ins). Pass a fully-formed VDS \`query\`.
- **\`site-content\`** — Raw VDS query against the "Site Content" datasource (workbooks,
  datasources, projects and their metadata). Pass a fully-formed VDS \`query\`.
- **\`job-performance\`** — Raw VDS query against the "Job Performance" datasource (extract
  refresh jobs, subscription jobs, flow runs, bridge jobs). Pass a fully-formed VDS \`query\`.
- **\`stale-content\`** — Server-side anti-join that returns already-filtered stale content
  rows. Pass optional \`minAgeDays\`, \`projectIds\`, \`itemTypes\`. Do NOT pass \`query\` or \`limit\`.

**Parameter reference by \`kind\`:**
- \`ts-events\` | \`site-content\` | \`job-performance\`: \`query\` (required), \`limit\` (optional).
- \`stale-content\`: \`minAgeDays\`, \`projectIds\`, \`itemTypes\` (all optional).

**Stale-content output schema (JSON):**
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

Notes:
- The Tableau-managed "Admin Insights" project is excluded from stale-content by design.
- \`Last Accessed At\` is \`null\` for items that have never been accessed; the report ages those
  items from \`Created At\` instead.
- The underlying datasource LUIDs are resolved automatically; callers do not pass \`datasourceLuid\`.
- This tool bypasses the standard datasource access checker because Admin Insights datasources
  are internal and admin-gated.
`.trim(),
    paramsSchema,
    annotations: {
      title: 'Query Admin Insights',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    callback: async (
      { kind, query, limit, minAgeDays, projectIds, itemTypes },
      extra,
    ): Promise<CallToolResult> => {
      const configWithOverrides = await extra.getConfigWithOverrides();

      if (kind === 'stale-content') {
        const thresholdDays = minAgeDays ?? configWithOverrides.staleContentMinAgeDays;
        const types = itemTypes ?? ['Workbook', 'Datasource'];
        const requestedProjectIds = _resolveProjectScopeIds({
          argProjectIds: projectIds,
          boundedProjectIds: configWithOverrides.boundedContext.projectIds,
        });

        return await tool.logAndExecute<StaleContentResult>({
          extra,
          args: { kind, minAgeDays: thresholdDays, projectIds, itemTypes: types },
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
                  const namesResult = await _resolveProjectIdsToNames({
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
                  query: _buildSiteContentQuery(types, projectNameScope),
                });
                if (siteContentResult.isErr()) {
                  return siteContentResult;
                }

                const universe = z
                  .array(_siteContentRowSchema)
                  .parse(siteContentResult.value.data ?? []);

                const today = new Date();
                const rows = computeStaleRows({ universe, thresholdDays, today });

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
      }

      return await tool.logAndExecute({
        extra,
        args: { kind, query, limit },
        callback: async () => {
          // Raw VDS kinds — query is required. Surfacing this from inside logAndExecute keeps the
          // invocation logged and telemetry-emitted; a pre-callback early return would silently
          // drop invocations that fail this check.
          if (!query) {
            return new ArgsValidationError(`query is required when kind is "${kind}".`).toErr();
          }

          // Take the tightest of the consolidated tool cap, the legacy per-kind tool cap, and the
          // caller-provided limit — so operators who set `MAX_RESULT_LIMITS=<legacy-tool>:N` in
          // their config keep that cap after migrating callers to the consolidated tool.
          const consolidatedCap = configWithOverrides.getMaxResultLimit(tool.name);
          const legacyCap = configWithOverrides.getMaxResultLimit(legacyToolByKind[kind]);
          const caps = [consolidatedCap, legacyCap, limit].filter(
            (v): v is number => typeof v === 'number' && v > 0,
          );
          const rowLimit = caps.length > 0 ? Math.min(...caps) : undefined;

          return await runAdminInsightsQuery({
            extra,
            jwtScopes: tool.requiredApiScopes,
            datasetName: kindToDataset(kind),
            query,
            rowLimit,
          });
        },
        constrainSuccessResult: (queryOutput) => ({ type: 'success', result: queryOutput }),
      });
    },
  });

  return tool;
};

function kindToDataset(kind: Exclude<Kind, 'stale-content'>): AdminInsightsDataset {
  switch (kind) {
    case 'ts-events':
      return ADMIN_INSIGHTS_DATASETS.TS_EVENTS;
    case 'site-content':
      return ADMIN_INSIGHTS_DATASETS.SITE_CONTENT;
    case 'job-performance':
      return ADMIN_INSIGHTS_DATASETS.JOB_PERFORMANCE;
  }
}

const legacyToolByKind: Record<Exclude<Kind, 'stale-content'>, WebToolName> = {
  'ts-events': 'query-admin-insights-ts-events',
  'site-content': 'query-admin-insights-site-content',
  'job-performance': 'query-admin-insights-job-performance',
};
