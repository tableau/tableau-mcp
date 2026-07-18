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
import {
  executeAdminInsightsQuery,
  QueryOutput,
  runAdminInsightsQuery,
} from './adminInsightsToolBase.js';
import {
  _buildProjectIdWarnings,
  _buildSiteContentQuery,
  _resolveProjectIdsToNames,
  _resolveProjectScopeIds,
  _siteContentRowSchema,
  _StaleReportWarning,
  computeStaleRows,
  StaleContentRow,
} from './getStaleContentReport.js';
import { ADMIN_INSIGHTS_DATASETS, AdminInsightsDataset } from './resolver.js';

/**
 * Dispatches on `kind` to one of four backends:
 *
 * - `ts-events` — raw VDS query against the "TS Events" datasource
 * - `site-content` — raw VDS query against the "Site Content" datasource
 * - `job-performance` — raw VDS query against the "Job Performance" datasource
 * - `stale-content` — server-side anti-join that returns already-filtered stale rows
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
  mcp?: { warnings: _StaleReportWarning[] };
};

export const getQueryAdminInsightsTool = (server: WebMcpServer): WebTool<typeof paramsSchema> => {
  const config = getConfig();
  const tool = new WebTool({
    server,
    name: 'query-admin-insights',
    disabled: !config.adminToolsEnabled,
    description: `
Queries the Tableau Admin Insights datasources on the current site. Restricted to site
administrators on Tableau Cloud sites with Admin Insights enabled.

Dispatches on \`kind\`:
- \`ts-events\` / \`site-content\` / \`job-performance\` — raw VDS query. Pass \`query\` (required)
  and optional \`limit\`.
- \`stale-content\` — server-side stale-content report. Pass optional \`minAgeDays\`, \`projectIds\`,
  \`itemTypes\`; do NOT pass \`query\` or \`limit\`.

Datasource LUIDs are resolved automatically; callers do not pass \`datasourceLuid\`.
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
        const { scopeIds: requestedProjectIds, boundedOutOfScopeIds } = _resolveProjectScopeIds({
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
                let unknownProjectIds: ReadonlyArray<string> = [];
                if (requestedProjectIds) {
                  const namesResult = await _resolveProjectIdsToNames({
                    restApi,
                    projectIds: requestedProjectIds,
                  });
                  if (namesResult.isErr()) {
                    return namesResult;
                  }
                  projectNameScope = namesResult.value.names;
                  unknownProjectIds = namesResult.value.unknownIds;
                }

                const hasRemainingScope = !!(projectNameScope && projectNameScope.length > 0);
                const warnings = _buildProjectIdWarnings({
                  boundedOutOfScopeIds,
                  unknownProjectIds,
                  hasRemainingScope,
                });

                // Widening guard: a scope was requested but nothing resolved to a real project.
                // Return an empty report + warnings instead of falling through to an unscoped query.
                if (requestedProjectIds && projectNameScope && projectNameScope.length === 0) {
                  return new Ok({
                    thresholdDays,
                    totalStaleItems: 0,
                    totalStaleSizeBytes: 0,
                    rows: [] as StaleContentRow[],
                    ...(warnings.length > 0 ? { mcp: { warnings } } : {}),
                  });
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
                  ...(warnings.length > 0 ? { mcp: { warnings } } : {}),
                });
              },
            });
          },
          constrainSuccessResult: (result) => ({ type: 'success', result }),
        });
      }

      return await tool.logAndExecute<QueryOutput>({
        extra,
        args: { kind, query, limit },
        callback: async () => {
          // Raw VDS kinds — query is required. Surfacing this from inside logAndExecute keeps the
          // invocation logged and telemetry-emitted; a pre-callback early return would silently
          // drop invocations that fail this check.
          if (!query) {
            return new ArgsValidationError(`query is required when kind is "${kind}".`).toErr();
          }

          const toolCap = configWithOverrides.getMaxResultLimit(tool.name);
          const caps = [toolCap, limit].filter((v): v is number => typeof v === 'number' && v > 0);
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
