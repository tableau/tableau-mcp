import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import {
  bindExplicitTemplate,
  formatExplicitBindErrors,
} from '../../../../desktop/binder/explicit-bind.js';
import { summarizeSchema } from '../../../../desktop/binder/schema-summary.js';
import { DesktopCache } from '../../../../desktop/cache.js';
import { resolveField } from '../../../../desktop/metadata/index.js';
import { resolveSession } from '../../../../desktop/session/sessionResolution.js';
import { listTemplateNames, readBookmark } from '../../../../desktop/templates/templatePath.js';
import { createTemplateRuntimeSnapshot } from '../../../../desktop/templates/templateRuntimeSnapshot.js';
import { getWorkbookXml } from '../../../../desktop/wrappers/getWorkbookXml.js';
import {
  ArgsValidationError,
  DesktopCommandExecutionError,
} from '../../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../../server.desktop.js';
import { getExceptionMessage } from '../../../../utils/getExceptionMessage.js';
import { attachNextAction, prefillNextAction } from '../../structuredContent.js';
import { DesktopTool } from '../../tool.js';
import { buildWorksheetsFromTemplatesParamsSchema } from '../templates/buildWorksheetsFromTemplates.js';
import { dashboardCreationPrerequisite } from './dashboardCreationPrerequisite.js';

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
    query: z.string(),
    datasource: z.string().optional(),
  }),
]);

const paramsSchema = {
  session: z.string().optional(),
  dashboardName: z.string(),
  title: z.string().optional(),
  layout: z
    .object({
      type: z.enum(['auto-grid', 'rows', 'columns', 'custom']),
      gridColumns: z.number().optional(),
      kpiStripHeight: z.number().optional(),
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
        .optional(),
    })
    .optional(),
  worksheets: z.array(
    z.object({
      name: z.string().trim(),
      type: z.enum(['kpi', 'chart']),
      template: z.string().trim().optional(),
      fields: z.array(plannerFieldSchema),
    }),
  ),
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

const toolTitle = 'Planning dashboard';
export const getPlanDashboardCreationTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const tool = new DesktopTool({
    server,
    name: 'plan-dashboard-creation',
    title: toolTitle,
    description: 'Plan tasks; manual registration.',
    paramsSchema,
    annotations: {
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
          const invalidKpi = worksheets.find(
            (worksheet) => worksheet.type === 'kpi' && worksheet.fields.length !== 1,
          );
          if (invalidKpi) {
            return new ArgsValidationError(
              `KPI worksheet "${invalidKpi.name}" requires exactly one field; received ${invalidKpi.fields.length}. Create one KPI worksheet per measure.`,
            ).toErr();
          }

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
          const schema = summarizeSchema(workbookXml);
          const snapshots = new Map<string, ReturnType<typeof createTemplateRuntimeSnapshot>>();
          const worksheetTasks = [];
          for (const ws of worksheets) {
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
            if (resolvedDatasources.length !== 1) {
              return new ArgsValidationError(
                `Worksheet "${ws.name}" requires fields from exactly one datasource.`,
              ).toErr();
            }
            let snapshot = snapshots.get(templateName);
            if (!snapshot) {
              try {
                const bookmark = readBookmark(templateName);
                if (bookmark === null) {
                  return new ArgsValidationError(
                    `Template "${templateName}" is not available.`,
                  ).toErr();
                }
                snapshot = createTemplateRuntimeSnapshot(templateName, bookmark);
                snapshots.set(templateName, snapshot);
              } catch (error) {
                return new ArgsValidationError(getExceptionMessage(error)).toErr();
              }
            }
            if (!snapshot.eligibility.pass1_eligible) {
              return new ArgsValidationError(
                `Template "${templateName}" is not eligible for worksheet template application.`,
              ).toErr();
            }
            const binding = bindExplicitTemplate(templateName, resolvedFields, schema, {
              contract: snapshot.descriptor,
              title: ws.name,
              datasource: resolvedDatasources[0],
            });
            if (!binding.ok) {
              return new ArgsValidationError(
                `Worksheet "${ws.name}": ${formatExplicitBindErrors(templateName, binding.errors)}`,
              ).toErr();
            }
            if (binding.consumedFieldRefs.length < new Set(resolvedFields).size) {
              return new ArgsValidationError(
                `Worksheet "${ws.name}": template "${templateName}" cannot use every requested field. Choose a compatible template or fewer fields.`,
              ).toErr();
            }
            const fieldMapping = Object.fromEntries(
              binding.templateSlots.flatMap((slot) => {
                const key = slot.qualified_key_required
                  ? `${slot.template_field}@${slot.derivation}`
                  : slot.template_field;
                const field = binding.fieldMapping[key];
                return field === undefined ? [] : [[slot.slot_id, field]];
              }),
            );
            const buildArgs = z.object(buildWorksheetsFromTemplatesParamsSchema).safeParse({
              session: resolvedSession,
              templateName,
              title: ws.name,
              datasource: binding.datasource,
              fieldMapping,
            });
            if (!buildArgs.success) {
              return new ArgsValidationError(
                `Worksheet "${ws.name}" has invalid template build inputs: ${buildArgs.error.message}`,
              ).toErr();
            }
            worksheetTasks.push({
              task_type: 'worksheet' as const,
              worksheetName: ws.name,
              worksheetFile,
              build: {
                tool: 'build-worksheets-from-templates',
                params: buildArgs.data,
              },
              apply: {
                tool: 'apply-worksheet',
                params: { session: resolvedSession, worksheetName: ws.name },
                artifactBinding: { from: 'build', resultPath: 'artifactId', bindTo: 'artifactId' },
              },
            });
          }

          const safeDashName = dashboardName.replace(/[^a-zA-Z0-9]/g, '_');
          const dashboardFile = cache.getCacheFilePath({ prefix: 'dashboard', id: safeDashName });

          const canParallelize = worksheets.length >= 5;
          const recommendedParallelism = Math.min(worksheets.length, 10);

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
            session: resolvedSession,
            dashboardName,
            dashboardFile,
            title,
            layoutSpec,
            worksheetNames: worksheets.map((ws) => ws.name),
            workbookFile,
          };

          const registration = dashboardCreationPrerequisite(
            dashboardName,
            dashboardTask.worksheetNames,
          );

          const plan = {
            dashboardName,
            title,
            metadata: {
              automaticCompletionSupported: !registration.required,
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
                session: resolvedSession,
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
                'Build and apply worksheet tasks only; wait for every worksheet to finish before registration',
              canParallelize,
              recommendedParallelism,
              tasks: worksheetTasks,
            },
            phase3Registration: {
              ...registration,
              dependsOn: 'phase2Parallel',
            },
            phase4Dashboard: {
              dependsOn: 'phase3Registration',
              description:
                'Apply the dashboard only after Desktop has registered every requested worksheet view',
              refreshCaches: [
                {
                  tool: 'get-workbook-xml',
                  params: { session: resolvedSession, mode: 'file' },
                  resultPath: 'file',
                  bindTo: 'workbookFile',
                },
                {
                  tool: 'get-dashboard-xml',
                  params: { session: resolvedSession, dashboardName, mode: 'file' },
                  resultPath: 'file',
                  bindTo: 'dashboardFile',
                },
              ],
              tool: 'build-and-apply-dashboard',
              task: dashboardTask,
              fileBinding:
                "Replace task.workbookFile and task.dashboardFile with the refreshed tools' returned file paths; do not reuse the Phase 1 paths.",
            },
          };

          const lines = [
            'DASHBOARD CREATION PLAN',
            `Dashboard: "${dashboardName}"${title ? `\nTitle: "${title}"` : ''}`,
            `Worksheets: ${worksheets.length}`,
            ...(registration.required
              ? [
                  'AUTOMATIC COMPLETION BLOCKED: new dashboard views require registration in Tableau Desktop.',
                  'This plan requires a user action after worksheet apply. Do not start Phase 1 expecting unattended completion.',
                ]
              : []),
            '',
            'PHASE 1: Batch Create & Cache',
            'Tool: batch-create-and-cache-sheets',
            `  worksheetNames: [${worksheets.map((ws) => `"${ws.name}"`).join(', ')}]`,
            `  dashboardName: "${dashboardName}"`,
            '',
            `PHASE 2: Build and Apply Worksheets (${canParallelize ? 'PARALLELIZE' : 'Sequential'})`,
          ];

          if (canParallelize) {
            lines.push(
              `Spawn ${worksheetTasks.length} worksheet subagents in parallel.`,
              'Tools: build-worksheets-from-templates then apply-worksheet. Do not apply the dashboard in parallel.',
            );
          } else {
            lines.push('Build and apply worksheet tasks sequentially.');
          }

          lines.push(
            'For each worksheet: call task.build.tool with task.build.params, then pass its returned artifactId to task.apply.tool with task.apply.params.',
            'Build each artifact after Phase 1 creates the worksheet. Do not pass the scaffold worksheetFile with artifactId; these are separate apply modes.',
          );

          lines.push(
            '',
            'PHASE 3: Register Views in Tableau Desktop (required user action)',
            ...(registration.required
              ? registration.instructions
              : ['No worksheets requested; no registration needed.']),
            '',
            'PHASE 4: Refresh Caches and Apply Dashboard',
            'Only after Phase 3: get-workbook-xml and get-dashboard-xml with mode="file", then build-and-apply-dashboard using their returned file paths.',
            'Dashboard apply checks the live registrations and verifies readback. A missing registration stops the apply without a write.',
          );

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
