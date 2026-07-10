import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { randomUUID } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { loadWorksheetXml } from '../../../desktop/commands/workbook/loadWorksheetXml.js';
import { listAvailableFields } from '../../../desktop/metadata/index.js';
import { spliceBoundFacet } from '../../../desktop/templates/facetSplice.js';
import { ensureUserNamespace } from '../../../desktop/templates/injectTemplateCore.js';
import { rewriteFieldReferences } from '../../../desktop/templates/fieldReferenceRewriter.js';
import { getTemplateColumnRequirements } from '../../../desktop/templates/templateColumnRequirements.js';
import { readTemplate } from '../../../desktop/templates/templatePath.js';
import {
  ArgsValidationError,
  DesktopCommandExecutionError,
  FileNotFoundError,
  WorksheetXmlLoadFailedError,
} from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { DesktopTool } from '../tool.js';

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

const paramsSchema = {
  session: z.string().describe('Session ID from list-instances.'),
  taskSpec: z
    .object({
      worksheetName: z.string(),
      worksheetFile: z.string().describe('Cached worksheet XML file.'),
      type: z.enum(['kpi', 'chart']),
      template: z.string().optional().describe('Template name.'),
      fields: z.array(z.string()).describe('Column refs to use.'),
      workbookFile: z.string().describe('Cached workbook XML file.'),
    })
    .describe('Task spec from plan-dashboard-creation.'),
};

const toolTitle = 'Build and Apply Worksheet';
export const getBuildAndApplyWorksheetTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const tool = new DesktopTool({
    server,
    name: 'build-and-apply-worksheet',
    title: toolTitle,
    description: [
      'Build worksheet XML from a template and immediately APPLY it to the live workbook.',
      'Designed for parallel Phase-2 execution by subagents. Details: expertise://tableau/tactics/viz/worksheets.',
    ].join(' '),
    paramsSchema,
    annotations: {
      title: toolTitle,
      readOnlyHint: false,
      openWorldHint: false,
      destructiveHint: true,
      idempotentHint: false,
    },
    callback: async ({ session, taskSpec }, extra): Promise<CallToolResult> => {
      return await tool.logAndExecute({
        extra,
        args: { session, taskSpec },
        callback: async () => {
          const { worksheetName, workbookFile, template, fields } = taskSpec;

          if (!existsSync(workbookFile)) {
            return new FileNotFoundError(workbookFile).toErr();
          }

          if (!template) {
            return new ArgsValidationError(
              'taskSpec.template is required. KPIs default to "kpi-text"; charts should use a chart-specific template (e.g., "ranking-ordered-bar"). Re-run plan-dashboard-creation to get a plan with templates populated.',
            ).toErr();
          }

          // SEA-aware template read (#433 seam): embedded asset in a SEA binary, disk otherwise.
          let templateXml = readTemplate(template);
          if (!templateXml) {
            return new ArgsValidationError(
              `Template not found: "${template}". Check available templates with list-xml-templates.`,
            ).toErr();
          }

          const workbookXml = readFileSync(workbookFile, 'utf-8');

          // Determine datasource name from workbook
          let datasourceName = 'Unknown';
          const captionMatch = workbookXml.match(/<datasource[^>]+caption=["']([^"']+)["']/);
          if (captionMatch) {
            datasourceName = captionMatch[1];
          } else {
            const allMatches = workbookXml.matchAll(/<datasource[^>]+name=["']([^"']+)["']/g);
            for (const match of allMatches) {
              if (match[1] !== 'Parameters') {
                datasourceName = match[1];
                break;
              }
            }
          }

          // Get available fields for role detection
          const availableFields = listAvailableFields(workbookXml);

          // Fields dropped here (no role match, or beyond the template's slot count)
          // used to vanish silently (pinned by X1). Collect a non-breaking warning
          // naming each dropped field; the index-based slot assignment below is
          // intentionally UNCHANGED (a bigger redesign, not this lane).
          const warnings: string[] = [];

          // Group provided fields by role
          const dimensionFields: string[] = [];
          const measureFields: string[] = [];
          for (const columnRef of fields) {
            const field = availableFields.find((f) => f.column_ref === columnRef);
            if (field?.role === 'dimension') dimensionFields.push(columnRef);
            else if (field?.role === 'measure') measureFields.push(columnRef);
            else
              warnings.push(
                `Field "${columnRef}" was dropped: it has no known dimension/measure role in the workbook's available fields.`,
              );
          }

          // Map template requirements to provided fields
          const templateRequirements = getTemplateColumnRequirements(templateXml);
          const templateDimensions = templateRequirements.filter((c) => c.role === 'dimension');
          const templateMeasures = templateRequirements.filter((c) => c.role === 'measure');

          const fieldMapping: Record<string, string> = {};
          const fieldMetadata: Record<string, { datatype: string; type: string }> = {};

          for (let i = 0; i < templateDimensions.length && i < dimensionFields.length; i++) {
            const columnRef = dimensionFields[i];
            const field = availableFields.find((f) => f.column_ref === columnRef);
            fieldMapping[templateDimensions[i].name] = columnRef;
            if (field?.datatype && field.type) {
              fieldMetadata[templateDimensions[i].name] = {
                datatype: field.datatype,
                type: field.type,
              };
            }
          }

          for (let i = 0; i < templateMeasures.length && i < measureFields.length; i++) {
            const columnRef = measureFields[i];
            const field = availableFields.find((f) => f.column_ref === columnRef);
            fieldMapping[templateMeasures[i].name] = columnRef;
            if (field?.datatype && field.type) {
              fieldMetadata[templateMeasures[i].name] = {
                datatype: field.datatype,
                type: field.type,
              };
            }
          }

          // Role-matched fields that overflowed the template's slot count are
          // dropped by the index-bounded loops above; name each one.
          for (const dropped of dimensionFields.slice(templateDimensions.length)) {
            warnings.push(
              `Dimension field "${dropped}" was dropped: template "${template}" exposes only ${templateDimensions.length} dimension slot(s).`,
            );
          }
          for (const dropped of measureFields.slice(templateMeasures.length)) {
            warnings.push(
              `Measure field "${dropped}" was dropped: template "${template}" exposes only ${templateMeasures.length} measure slot(s).`,
            );
          }

          // Inject title and replace field references. Per-apply calc namespacing is
          // wired at this tool boundary: the shared core defaults namespacing OFF and
          // never mints its own nonce, so derive one from session + apply timestamp
          // (randomUUID guards same-millisecond applies). Distinct nonces => distinct
          // calc-name suffixes => repeated applies into one workbook don't collide.
          templateXml = templateXml.replace(/\{\{TITLE\}\}/g, escapeXml(worksheetName));
          const applyNonce = `${session}:${Date.now()}:${randomUUID()}`;
          // W28-C: splice a BOUND facet pill onto the trellis shelf BEFORE the frozen
          // core rewrite (identity no-op when no facet is bound). The core then maps
          // [Facet] → the bound field so the facet actually renders.
          templateXml = ensureUserNamespace(templateXml);
          templateXml = spliceBoundFacet(templateXml, fieldMapping);
          templateXml = rewriteFieldReferences(
            templateXml,
            fieldMapping,
            datasourceName,
            fieldMetadata,
            { namespaceCalcs: true, applyNonce },
          );

          // Extract worksheet element
          const worksheetMatch = templateXml.match(/<worksheet(?!s)[^>]*>[\s\S]*?<\/worksheet>/);
          if (!worksheetMatch) {
            return new ArgsValidationError(
              `Invalid template format: "${template}". Template must contain a <worksheet> element.`,
            ).toErr();
          }
          const worksheetXml = worksheetMatch[0];

          // Apply to Tableau
          const executor = await extra.getExecutor(session);
          const signal = extra.signal;
          const applyResult = await loadWorksheetXml({
            worksheetName,
            xml: worksheetXml,
            executor,
            signal,
          });

          if (applyResult.isErr()) {
            const { type, error } = applyResult.error;
            switch (type) {
              case 'execute-command-error':
                return new DesktopCommandExecutionError(error).toErr();
              case 'load-worksheet-xml-error':
                return new WorksheetXmlLoadFailedError(error).toErr();
              default: {
                const _exhaustive: never = type;
              }
            }
          }

          return new Ok({
            message: `Built and applied worksheet "${worksheetName}" using template "${template}" with ${fields.length} fields.`,
            worksheetName,
            template,
            fieldCount: fields.length,
            warnings,
          });
        },
      });
    },
  });
  return tool;
};
