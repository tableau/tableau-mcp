import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { randomUUID } from 'crypto';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import {
  ArgsValidationError,
  FileNotFoundError,
  FileReadError,
  XmlValidationError,
} from '../../errors/sharedMcpToolError.js';
import {
  bindExplicitTemplate,
  formatExplicitBindErrors,
} from '../../metadata/binder/explicit-bind.js';
import { summarizeSchema } from '../../metadata/binder/schema-summary.js';
import { buildInjectedWorkbookXml } from '../../metadata/templates/injectTemplateCore.js';
import type { OptionalFieldPruneSpec } from '../../metadata/templates/optionalFieldPrune.js';
import type { TemplateRuntimeSnapshot } from '../../metadata/templates/templateRuntimeSnapshot.js';
import type { Server } from '../../server.js';
import { SharedTool } from '../shared/tool.js';

const paramsSchema = {
  workbookFile: z.string().describe('Cached workbook path.'),
  templateName: z.string().describe('Existing template ID.'),
  title: z.string().describe('New sheet name.'),
  sheetType: z.enum(['worksheet', 'dashboard', 'story']).describe('Template output type.'),
  templateParameters: z
    .record(z.string())
    .optional()
    .describe('Required placeholders, including DATASOURCE.'),
  fieldMapping: z.record(z.string()).optional().describe('Resolved slot-to-field refs.'),
  insertPosition: z
    .enum(['end', 'before_sheet', 'after_sheet'])
    .optional()
    .describe('Placement relative to the anchor; default end.'),
  relativeSheetName: z.string().optional().describe('Existing anchor sheet; omit for end.'),
};

const toolTitle = 'Adding template';
export const getInjectTemplateTool = (
  server: Server,
  catalog: {
    getRuntimeTemplateSnapshot(name: string): TemplateRuntimeSnapshot | null;
    listTemplateNames(): string[];
  },
): SharedTool<typeof paramsSchema> => {
  const tool = new SharedTool({
    server,
    name: 'inject-template',
    title: toolTitle,
    description: 'Inject a template.',
    paramsSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
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

          const runtimeSnapshot = catalog.getRuntimeTemplateSnapshot(templateName);
          if (runtimeSnapshot === null) {
            const files = catalog.listTemplateNames();
            const available = files.length > 0 ? files.join(', ') : 'none';
            return new ArgsValidationError(
              `Template "${templateName}" not found.\n\nAvailable templates: ${available}\n\nUse the template list tool to see all options.`,
            ).toErr();
          }

          try {
            const templateXml = runtimeSnapshot.xml;
            const workbookXml = readFileSync(resolve(workbookFile), 'utf-8');

            // Per-apply calc namespacing identity: the shared core defaults
            // namespacing OFF and never mints its own nonce, so the caller supplies
            // one. Include the target path, time, and a UUID to avoid collisions.
            // Runtime descriptor enforcement (P0 W-23447710): a caller-supplied mapping
            // is validated/corrected through the binder contract — slot derivations come
            // from the inferred TBM structure, not the caller.
            let appliedFieldMapping = fieldMapping;
            let appliedTemplateParameters = templateParameters;
            let optionalFieldPrunes: OptionalFieldPruneSpec[] = [];
            const explicitTemplateWarnings: string[] = [];
            if (
              templateParameters?.DATASOURCE &&
              fieldMapping &&
              Object.keys(fieldMapping).length > 0
            ) {
              const explicitBind = bindExplicitTemplate(
                templateName,
                fieldMapping,
                summarizeSchema(workbookXml),
                {
                  contract: runtimeSnapshot.descriptor,
                  title,
                  datasource: templateParameters.DATASOURCE,
                },
              );

              if (!explicitBind.ok) {
                return new ArgsValidationError(
                  formatExplicitBindErrors(templateName, explicitBind.errors),
                ).toErr();
              }

              const resolvedDatasource = explicitBind.datasource;

              if (resolvedDatasource !== templateParameters.DATASOURCE) {
                return new ArgsValidationError(
                  `Explicit template binding BLOCKED for "${templateName}". No worksheet was produced.\n\n` +
                    `  • [datasource-mismatch] caller DATASOURCE "${templateParameters.DATASOURCE}" does not match resolved mapping datasource "${resolvedDatasource}".\n` +
                    `    FIX: Set templateParameters.DATASOURCE to "${resolvedDatasource}" and retry with the same fieldMapping.`,
                ).toErr();
              }

              appliedFieldMapping = explicitBind.fieldMapping;
              optionalFieldPrunes = explicitBind.optionalFieldPrunes;
              appliedTemplateParameters = {
                ...templateParameters,
                DATASOURCE: resolvedDatasource,
              };
              explicitTemplateWarnings.push(...explicitBind.warnings);
            }

            const applyNonce = `${workbookFile}:${Date.now()}:${randomUUID()}`;
            const result = buildInjectedWorkbookXml({
              workbookXml,
              templateXml,
              title,
              sheetType,
              templateParameters: appliedTemplateParameters,
              fieldMapping: appliedFieldMapping,
              templateSlots: runtimeSnapshot.descriptor.slots,
              insertPosition,
              relativeSheetName,
              applyNonce,
              optionalFieldPrunes,
            });

            if (!result.ok) {
              return new XmlValidationError(result.issues).toErr();
            }

            writeFileSync(resolve(workbookFile), result.xml, 'utf-8');

            return new Ok({
              workbookFile,
              templateName,
              title,
              sheetType,
              warnings: [...explicitTemplateWarnings, ...(result.warnings ?? [])],
            });
          } catch (err) {
            return new FileReadError(err).toErr();
          }
        },
        getSuccessResult: ({ workbookFile, templateName, title, sheetType, warnings }) => ({
          content: [
            {
              type: 'text',
              text:
                `Injected template "${templateName}" as "${title}" (${sheetType}).` +
                (warnings.length > 0
                  ? `\n\nTemplate advisory warnings:\n${warnings.map((w) => `  - ${w}`).join('\n')}`
                  : '') +
                `\n\nUpdated file: ${workbookFile}\n\nUse apply-workbook to apply changes to Tableau.`,
            },
          ],
        }),
      });
    },
  });
  return tool;
};
