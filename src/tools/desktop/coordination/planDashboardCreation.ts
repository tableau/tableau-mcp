import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { DesktopCache } from '../../../desktop/cache.js';
import { getWorkbookXml } from '../../../desktop/commands/workbook/getWorkbookXml.js';
import { resolveField } from '../../../desktop/metadata/index.js';
import { resolveSession } from '../../../desktop/sessionResolution.js';
import { listTemplateNames } from '../../../desktop/templates/templatePath.js';
import { ArgsValidationError, DesktopCommandExecutionError } from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { attachNextAction, prefillNextAction } from '../structuredContent.js';
import { DesktopTool } from '../tool.js';
import { markPlanBuildWorksheets } from './planBuildFocus.js';

type PlannerField = string | { query: string; datasource?: string };
type PlannerFieldRequest = { query: string; datasource?: string };
type PlannerFieldResolution = {
  query: string;
  datasourceSelector?: string;
  kind: ReturnType<typeof resolveField>['kind'];
  columnRef: string | null;
  datasource: string | null;
  reason?: string;
  candidates: string[];
};

const plannerFieldSchema = z.union([
  z.string(),
  z.object({
    query: z.string().describe(''),
    datasource: z.string().optional().describe(''),
  }),
]);

const paramsSchema = {
  session: z.string().optional().describe(''),
  dashboardName: z.string().describe(''),
  title: z.string().optional().describe(''),
  layout: z
    .object({
      type: z.enum(['auto-grid', 'rows', 'columns', 'custom']).describe(''),
      gridColumns: z.number().optional().describe(''),
      kpiStripHeight: z.number().optional().describe(''),
      zones: z
        .array(
          z.object({
            worksheetName: z.string(),
            x: z.number(),
            y: z.number(),
            width: z.number(),
            height: z.number(),
          }),
        )
        .optional()
        .describe(''),
    })
    .optional()
    .describe(''),
  worksheets: z
    .array(
      z.object({
        name: z.string().describe(''),
        type: z.enum(['kpi', 'chart']).describe(''),
        template: z.string().optional().describe(''),
        fields: z.array(plannerFieldSchema).describe(''),
      }),
    )
    .describe(''),
};

function selectTemplate(ws: { type: string; template?: string }): string {
  if (ws.template) return ws.template;
  return ws.type === 'kpi' ? 'kpi-text' : 'ranking-ordered-bar';
}

function normalizePlannerField(field: PlannerField): PlannerFieldRequest {
  return typeof field === 'string' ? { query: field } : field;
}

function fieldCacheKey(field: PlannerFieldRequest): string {
  return JSON.stringify([field.query, field.datasource ?? null]);
}

const toolTitle = 'Plan Dashboard Creation';
export const getPlanDashboardCreationTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const tool = new DesktopTool({
    server,
    name: 'plan-dashboard-creation',
    title: toolTitle,
    description: 'Plan dashboard tasks. parallel plan.',
    paramsSchema,
    annotations: {
      title: toolTitle,
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    callback: async (
      { session, dashboardName, title, layout, worksheets },
      extra,
    ): Promise<CallToolResult> => {
      return await tool.logAndExecute({
        extra,
        args: { session, dashboardName, title, layout, worksheets },
        callback: async () => {
          const sessionResult = resolveSession(session);
          if (sessionResult.isErr()) {
            return sessionResult.error.toErr();
          }
          const resolvedSession = sessionResult.value;
          const executor = await extra.getExecutor(resolvedSession);
          const signal = extra.signal;
          const workbookResult = await getWorkbookXml({ executor, signal });

          if (workbookResult.isErr()) {
            return new DesktopCommandExecutionError(workbookResult.error).toErr();
          }
          const workbookXml = workbookResult.value;

          const templateFiles = listTemplateNames();

          // Resolve all requested fields
          const cache = new DesktopCache(resolvedSession);
          const fieldMap = new Map<string, PlannerFieldResolution>();
          const aggregationWarnings: string[] = [];
          const ambiguousFields: Array<{
            field: string;
            datasource?: string;
            candidates: string[];
          }> = [];
          const notFoundFields: Array<{ field: string; datasource?: string }> = [];

          for (const ws of worksheets) {
            for (const requestedField of ws.fields.map(normalizePlannerField)) {
              const cacheKey = fieldCacheKey(requestedField);
              if (fieldMap.has(cacheKey)) continue;
              const resolution = resolveField(
                workbookXml,
                requestedField.query,
                requestedField.datasource ? { datasource: requestedField.datasource } : undefined,
              );
              const resolved: PlannerFieldResolution = {
                query: requestedField.query,
                datasourceSelector: requestedField.datasource,
                kind: resolution.kind,
                columnRef: resolution.column_ref ?? null,
                datasource: resolution.datasource ?? null,
                reason: resolution.reason,
                candidates: (resolution.candidates ?? []).map((c) => c.column_ref),
              };
              switch (resolution.kind) {
                case 'exact':
                  fieldMap.set(cacheKey, resolved);
                  break;
                case 'rewritten':
                  fieldMap.set(cacheKey, resolved);
                  if (resolution.rewrites?.includes('ignored-redundant-aggregation')) {
                    aggregationWarnings.push(`"${requestedField.query}": ${resolution.reason}`);
                  }
                  break;
                case 'ambiguous':
                  fieldMap.set(cacheKey, resolved);
                  ambiguousFields.push({
                    field: requestedField.query,
                    datasource: requestedField.datasource,
                    candidates: resolved.candidates,
                  });
                  break;
                case 'not_found':
                  fieldMap.set(cacheKey, resolved);
                  notFoundFields.push({
                    field: requestedField.query,
                    datasource: requestedField.datasource,
                  });
                  break;
              }
            }
          }

          // Block planning if any field cannot be resolved.
          if (ambiguousFields.length > 0 || notFoundFields.length > 0) {
            const summaryParts = [
              ...(ambiguousFields.length > 0 ? [`${ambiguousFields.length} ambiguous`] : []),
              ...(notFoundFields.length > 0 ? [`${notFoundFields.length} not_found`] : []),
            ];
            const lines: string[] = [
              `BLOCKED: ${summaryParts.join(' + ')} field reference${ambiguousFields.length + notFoundFields.length === 1 ? '' : 's'} — cannot plan dashboard`,
              '',
            ];
            if (ambiguousFields.length > 0) {
              lines.push(
                'Ambiguous (matches multiple columns — pick one):',
                ...ambiguousFields.map((a) => {
                  const selector = a.datasource ? ` (datasource "${a.datasource}")` : '';
                  return `  • "${a.field}"${selector} → candidates: ${a.candidates.map((c) => `"${c}"`).join(', ')}`;
                }),
              );
            }
            if (notFoundFields.length > 0) {
              lines.push(
                '',
                'Not found (no column with this name in any datasource):',
                ...notFoundFields.map((f) => {
                  const selector = f.datasource ? ` (datasource "${f.datasource}")` : '';
                  return `  • "${f.field}"${selector}`;
                }),
              );
            }
            lines.push(
              '',
              'Next step: disambiguate each field, then re-call plan-dashboard-creation.',
              '  • Use resolve-field with an explicit datasource.',
              '  • For not_found fields, call list-available-fields to see valid names.',
              '  • Use ask-user to surface the choice to the user.',
            );
            return attachNextAction(
              new ArgsValidationError(lines.join('\n')),
              prefillNextAction('Disambiguate each field before re-planning'),
            ).toErr();
          }

          // Cache workbook for subagents
          const workbookFile = cache.getCacheFilePath({
            prefix: 'workbook',
            id: 'for-parallel-build',
          });

          // Build worksheet tasks
          const worksheetTasks = worksheets.map((ws) => {
            const safeWsName = ws.name.replace(/[^a-zA-Z0-9]/g, '_');
            const worksheetFile = cache.getCacheFilePath({ prefix: 'worksheet', id: safeWsName });
            const templateName = selectTemplate(ws);
            const resolvedEntries = ws.fields
              .map(normalizePlannerField)
              .map((f) => fieldMap.get(fieldCacheKey(f)))
              .filter((r): r is PlannerFieldResolution => !!r && r.columnRef !== null);
            const resolvedFields = resolvedEntries.map((r) => r.columnRef!);
            const resolvedDatasources = [
              ...new Set(resolvedEntries.map((r) => r.datasource).filter((d): d is string => !!d)),
            ];
            return {
              task_type: 'worksheet' as const,
              worksheetName: ws.name,
              worksheetFile,
              type: ws.type,
              template: templateName,
              fields: resolvedFields,
              datasource: resolvedDatasources.length === 1 ? resolvedDatasources[0] : null,
              workbookFile,
            };
          });

          // Record that these worksheets belong to a multi-task plan whose FINAL dashboard
          // apply owns focus, so each (parallel) build-and-apply-worksheet suppresses its own
          // goto-sheet. Standalone callers of build-and-apply-worksheet are not recorded here
          // and keep focusing as before. Recorded regardless of canParallelize: sequential
          // plans also want the dashboard to own the final focus.
          markPlanBuildWorksheets(
            resolvedSession,
            worksheetTasks.map((t) => t.worksheetName),
          );

          const safeDashName = dashboardName.replace(/[^a-zA-Z0-9]/g, '_');
          const dashboardFile = cache.getCacheFilePath({ prefix: 'dashboard', id: safeDashName });

          const canParallelize = worksheets.length >= 5;
          const recommendedParallelism = Math.min(worksheets.length + 1, 10);

          const layoutType = layout?.type || 'auto-grid';
          const layoutSpec = {
            kpis: worksheets.filter((ws) => ws.type === 'kpi').map((ws) => ws.name),
            charts: worksheets.filter((ws) => ws.type === 'chart').map((ws) => ws.name),
            layoutType,
            gridColumns: layout?.gridColumns,
            kpiStripHeight: layout?.kpiStripHeight,
            customZones: layout?.zones,
          };

          const dashboardTask = {
            task_type: 'dashboard' as const,
            dashboardName,
            dashboardFile,
            title,
            layoutSpec,
            worksheetNames: worksheets.map((ws) => ws.name),
            workbookFile,
          };

          const allTasks = [...worksheetTasks, dashboardTask];

          const plan = {
            dashboardName,
            title,
            metadata: {
              totalWorksheets: worksheets.length,
              canParallelize,
              recommendedParallelism,
              resolvedFields: [...fieldMap.values()].filter((f) => f.columnRef !== null).length,
              unresolvedFields: notFoundFields.map((f) => f.field),
              aggregationWarnings,
              availableTemplates: templateFiles,
            },
            phase1Prework: {
              description:
                'Batch create all sheets + dashboard and cache empty working copies (single tool call)',
              tool: 'batch-create-and-cache-sheets',
              params: {
                worksheetNames: worksheets.map((ws) => ws.name),
                dashboardName,
              },
              expectedFiles: {
                worksheets: worksheetTasks.map((t) => ({
                  name: t.worksheetName,
                  file: t.worksheetFile,
                })),
                dashboard: dashboardFile,
                workbook: workbookFile,
              },
            },
            phase2Parallel: {
              description:
                'Build and apply ALL tasks in parallel (worksheets + dashboard together)',
              canParallelize,
              recommendedParallelism,
              tasks: allTasks,
            },
          };

          const lines = [
            'DASHBOARD CREATION PLAN',
            `Dashboard: "${dashboardName}"${title ? `\nTitle: "${title}"` : ''}`,
            `Worksheets: ${worksheets.length}`,
            '',
            'PHASE 1: Batch Create & Cache',
            'Tool: batch-create-and-cache-sheets',
            `  worksheetNames: [${worksheets.map((ws) => `"${ws.name}"`).join(', ')}]`,
            `  dashboardName: "${dashboardName}"`,
            '',
            `PHASE 2: Build and Apply (${canParallelize ? 'PARALLELIZE' : 'Sequential'})`,
          ];

          if (canParallelize) {
            lines.push(
              `Spawn ${allTasks.length} subagents in parallel (${worksheetTasks.length} worksheets + 1 dashboard).`,
              'Each subagent: reads cached file, builds the worksheet or dashboard, applies immediately.',
              'Tool: build-and-apply-worksheet (worksheets), build-and-apply-dashboard (dashboard)',
            );
          } else {
            lines.push('Build and apply tasks sequentially.');
          }

          if (aggregationWarnings.length > 0) {
            lines.push('', `WARNING: Redundant aggregation: ${aggregationWarnings.join('; ')}`);
          }

          lines.push('', 'FULL PLAN (JSON):', JSON.stringify(plan, null, 2));

          return new Ok({ message: lines.join('\n'), plan });
        },
      });
    },
  });
  return tool;
};
