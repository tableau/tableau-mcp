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

const paramsSchema = {
  session: z.string().optional().describe('Session ID; optional if pinned or unique.'),
  dashboardName: z.string().describe('Name of the dashboard to create.'),
  title: z.string().optional().describe('Optional dashboard title.'),
  layout: z
    .object({
      type: z.enum(['auto-grid', 'rows', 'columns', 'custom']).describe('Layout type.'),
      gridColumns: z.number().optional().describe('Auto-grid columns.'),
      kpiStripHeight: z.number().optional().describe('KPI strip height percent.'),
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
        .describe('Custom zone positions.'),
    })
    .optional()
    .describe('Dashboard layout.'),
  worksheets: z
    .array(
      z.object({
        name: z.string().describe('Worksheet name.'),
        type: z
          .enum(['kpi', 'chart'])
          .describe("Worksheet type: 'kpi' or 'chart' for viz worksheets."),
        template: z.string().optional().describe('Optional template name.'),
        fields: z.array(z.string()).describe('Viz field names.'),
      }),
    )
    .describe('List of worksheets to create.'),
};

function selectTemplate(ws: { type: string; template?: string }): string {
  if (ws.template) return ws.template;
  return ws.type === 'kpi' ? 'kpi-text' : 'ranking-ordered-bar';
}

const toolTitle = 'Plan Dashboard Creation';
export const getPlanDashboardCreationTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const tool = new DesktopTool({
    server,
    name: 'plan-dashboard-creation',
    title: toolTitle,
    description: [
      'Plan a dashboard: Phase 1 caches sheets; Phase 2 builds/applies in parallel.',
      'Resolve ambiguous fields first. expertise://tableau/strategy/dashboard-design/layout-patterns.',
    ].join(' '),
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
          const fieldMap: Record<string, string | null> = {};
          const aggregationWarnings: string[] = [];
          const ambiguousFields: Array<{ field: string; candidates: string[] }> = [];
          const notFoundFields: string[] = [];

          for (const ws of worksheets) {
            for (const fieldName of ws.fields) {
              if (fieldName in fieldMap) continue;
              const resolution = resolveField(workbookXml, fieldName);
              switch (resolution.kind) {
                case 'exact':
                  fieldMap[fieldName] = resolution.column_ref ?? null;
                  break;
                case 'rewritten':
                  fieldMap[fieldName] = resolution.column_ref ?? null;
                  if (resolution.rewrites?.includes('ignored-redundant-aggregation')) {
                    aggregationWarnings.push(`"${fieldName}": ${resolution.reason}`);
                  }
                  break;
                case 'ambiguous':
                  fieldMap[fieldName] = null;
                  ambiguousFields.push({
                    field: fieldName,
                    candidates: (resolution.candidates ?? []).map((c) => c.column_ref),
                  });
                  break;
                case 'not_found':
                  fieldMap[fieldName] = null;
                  notFoundFields.push(fieldName);
                  break;
              }
            }
          }

          // Block planning if any field is ambiguous
          if (ambiguousFields.length > 0) {
            const summaryParts = [
              `${ambiguousFields.length} ambiguous`,
              ...(notFoundFields.length > 0 ? [`${notFoundFields.length} not_found`] : []),
            ];
            const lines: string[] = [
              `BLOCKED: ${summaryParts.join(' + ')} field reference${ambiguousFields.length + notFoundFields.length === 1 ? '' : 's'} — cannot plan dashboard`,
              '',
              'Ambiguous (matches multiple columns — pick one):',
              ...ambiguousFields.map(
                (a) =>
                  `  • "${a.field}" → candidates: ${a.candidates.map((c) => `"${c}"`).join(', ')}`,
              ),
            ];
            if (notFoundFields.length > 0) {
              lines.push(
                '',
                'Not found (no column with this name in any datasource):',
                ...notFoundFields.map((f) => `  • "${f}"`),
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
            const resolvedFields = ws.fields
              .map((f) => fieldMap[f])
              .filter((r): r is string => r !== null);
            return {
              task_type: 'worksheet' as const,
              worksheetName: ws.name,
              worksheetFile,
              type: ws.type,
              template: templateName,
              fields: resolvedFields,
              workbookFile,
            };
          });

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
              resolvedFields: Object.keys(fieldMap).length - notFoundFields.length,
              unresolvedFields: notFoundFields,
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

          if (notFoundFields.length > 0) {
            lines.push('', `WARNING: Unresolved fields: ${notFoundFields.join(', ')}`);
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
