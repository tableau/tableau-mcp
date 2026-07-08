import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { randomUUID } from 'crypto';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { buildInjectedWorkbookXml } from '../../../desktop/templates/injectTemplateCore.js';
import { listTemplateNames, readTemplate } from '../../../desktop/templates/templatePath.js';
import {
  ArgsValidationError,
  FileNotFoundError,
  FileReadError,
  XmlValidationError,
} from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { DesktopTool } from '../tool.js';

const paramsSchema = {
  workbookFile: z
    .string()
    .describe('Path to workbook cache file (from get-workbook-xml with mode=file).'),
  templateName: z
    .string()
    .describe('Template name without .xml extension (use list-xml-templates to see options).'),
  title: z.string().describe('Name for the new sheet — replaces {{TITLE}} in the template.'),
  sheetType: z.enum(['worksheet', 'dashboard', 'story']).describe('Type of sheet being injected.'),
  templateParameters: z
    .record(z.string())
    .optional()
    .describe(
      'Additional {{PLACEHOLDER}} substitutions, e.g. {"DATASOURCE": "Sales Data"}. DATASOURCE is handled alongside fieldMapping.',
    ),
  fieldMapping: z
    .record(z.string())
    .optional()
    .describe(
      'Map of template field names to column-instance refs, e.g. {"Sales": "[sum:Sales:qk]", "Region": "[none:Region:nk]"}.',
    ),
  insertPosition: z
    .enum(['end', 'before_sheet', 'after_sheet'])
    .optional()
    .describe('Tab order position (default: end).'),
  relativeSheetName: z
    .string()
    .optional()
    .describe('Required when insertPosition is before_sheet or after_sheet.'),
};

const toolTitle = 'Inject Template';
export const getInjectTemplateTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const tool = new DesktopTool({
    server,
    name: 'inject-template',
    title: toolTitle,
    description: [
      'Inject a pre-built worksheet, dashboard, or story from a template file into a cached workbook XML file.',
      'Templates are TWB-format XML files; use list-xml-templates to see available names.',
      'Supports {{PLACEHOLDER}} substitution — {{TITLE}} is always replaced with the title argument.',
      'Workflow: get-workbook-xml (mode=file) → inject-template → apply-workbook.',
    ].join(' '),
    paramsSchema,
    annotations: {
      title: toolTitle,
      readOnlyHint: false,
      openWorldHint: false,
    },
    callback: async (
      {
        workbookFile,
        templateName,
        title,
        sheetType,
        templateParameters,
        fieldMapping,
        insertPosition,
        relativeSheetName,
      },
      extra,
    ): Promise<CallToolResult> => {
      return await tool.logAndExecute({
        extra,
        args: {
          workbookFile,
          templateName,
          title,
          sheetType,
          templateParameters,
          fieldMapping,
          insertPosition,
          relativeSheetName,
        },
        callback: async () => {
          if (!existsSync(resolve(workbookFile))) {
            return new FileNotFoundError(workbookFile).toErr();
          }

          const templateXmlSource = readTemplate(templateName);
          if (templateXmlSource === null) {
            const files = listTemplateNames();
            const available = files.length > 0 ? files.join(', ') : 'none';
            return new ArgsValidationError(
              `Template "${templateName}" not found.\n\nAvailable templates: ${available}\n\nUse list-xml-templates to see all options.`,
            ).toErr();
          }

          try {
            const templateXml = templateXmlSource;
            const workbookXml = readFileSync(resolve(workbookFile), 'utf-8');

            // Per-apply calc namespacing identity: the shared core defaults
            // namespacing OFF and never mints its own nonce, so the caller supplies
            // one. inject-template has no session, so the per-apply identity is the
            // target workbook file + apply timestamp; a randomUUID guards against
            // same-millisecond collisions.
            const applyNonce = `${workbookFile}:${Date.now()}:${randomUUID()}`;
            const result = buildInjectedWorkbookXml({
              workbookXml,
              templateXml,
              title,
              sheetType,
              templateParameters,
              fieldMapping,
              insertPosition,
              relativeSheetName,
              applyNonce,
            });

            if (!result.ok) {
              return new XmlValidationError(result.issues).toErr();
            }

            writeFileSync(resolve(workbookFile), result.xml, 'utf-8');

            return new Ok({ workbookFile, templateName, title, sheetType });
          } catch (err) {
            return new FileReadError(err).toErr();
          }
        },
        getSuccessResult: ({ workbookFile, templateName, title, sheetType }) => ({
          content: [
            {
              type: 'text',
              text: `Injected template "${templateName}" as "${title}" (${sheetType}).\n\nUpdated file: ${workbookFile}\n\nUse apply-workbook to apply changes to Tableau.`,
            },
          ],
        }),
      });
    },
  });
  return tool;
};
