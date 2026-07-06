import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { existsSync, readFileSync } from 'fs';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { loadWorksheetXml } from '../../../desktop/commands/workbook/loadWorksheetXml.js';
import { listAvailableFields } from '../../../desktop/metadata/index.js';
import {
  getTemplateColumnRequirements,
  replaceFieldReferences,
} from '../../../desktop/templates/replaceFieldReferences.js';
import { getTemplatePath } from '../../../desktop/templates/templatePath.js';
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
      worksheetFile: z.string().describe('Path to cached empty worksheet XML (from Phase 1).'),
      type: z.enum(['kpi', 'chart']),
      template: z
        .string()
        .optional()
        .describe('Template name (e.g., "ranking-ordered-bar", "kpi-text").'),
      fields: z
        .array(z.string())
        .describe(
          "List of column refs (e.g., '[Sample - Superstore].[sum:Sales:qk]') to use in this worksheet.",
        ),
      workbookFile: z.string().describe('Path to cached workbook XML.'),
    })
    .describe('Task specification from plan-dashboard-creation.'),
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
      'Build worksheet XML from a template and immediately apply it to Tableau.',
      'Designed for parallel execution by subagents in Phase 2 of the dashboard creation workflow.',
      'Reads template, maps provided fields to template placeholders, generates XML, and applies immediately.',
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

          const templatePath = getTemplatePath(template);
          if (!existsSync(templatePath)) {
            return new ArgsValidationError(
              `Template not found: "${template}". Check available templates with list-xml-templates.`,
            ).toErr();
          }

          const workbookXml = readFileSync(workbookFile, 'utf-8');
          let templateXml = readFileSync(templatePath, 'utf-8');

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

          // Group provided fields by role
          const dimensionFields: string[] = [];
          const measureFields: string[] = [];
          for (const columnRef of fields) {
            const field = availableFields.find((f) => f.column_ref === columnRef);
            if (field?.role === 'dimension') dimensionFields.push(columnRef);
            else if (field?.role === 'measure') measureFields.push(columnRef);
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

          // Inject title and replace field references
          templateXml = templateXml.replace(/\{\{TITLE\}\}/g, escapeXml(worksheetName));
          templateXml = replaceFieldReferences(
            templateXml,
            fieldMapping,
            datasourceName,
            fieldMetadata,
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
          });
        },
      });
    },
  });
  return tool;
};
