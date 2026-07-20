import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { randomUUID } from 'crypto';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import {
  bindExplicitTemplate,
  formatExplicitBindErrors,
} from '../../../desktop/binder/explicit-bind.js';
import { summarizeSchema } from '../../../desktop/binder/schema-summary.js';
import { writeSidecar } from '../../../desktop/commands/workbook/cacheFingerprint.js';
import { parseDatasourceQualifiedColumnRef } from '../../../desktop/metadata/field-resolver.js';
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
  session: z.string().describe(''),
  workbookFile: z.string().describe(''),
  templateName: z.string().describe(''),
  title: z.string().describe(''),
  sheetType: z.enum(['worksheet', 'dashboard', 'story']).describe(''),
  templateParameters: z.record(z.string()).optional().describe(''),
  fieldMapping: z.record(z.string()).optional().describe(''),
  insertPosition: z.enum(['end', 'before_sheet', 'after_sheet']).optional().describe(''),
  relativeSheetName: z.string().optional().describe(''),
};

function inferSingleDatasourceFromFieldMapping(
  fieldMapping?: Record<string, string>,
): string | null {
  const datasources = new Set<string>();
  for (const ref of Object.values(fieldMapping ?? {})) {
    const datasource = parseDatasourceQualifiedColumnRef(ref.trim())?.datasource;
    if (datasource) datasources.add(datasource);
  }
  return datasources.size === 1 ? [...datasources][0] : null;
}

const toolTitle = 'Inject Template';
export const getInjectTemplateTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const tool = new DesktopTool({
    server,
    name: 'inject-template',
    title: toolTitle,
    description: [
      'Inject a template into a cached workbook (mutates).',
      'Supports {{TITLE}}. Then apply-workbook.',
    ].join(' '),
    paramsSchema,
    annotations: {
      title: toolTitle,
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    callback: async (
      {
        session,
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
          session,
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
              `Template "${templateName}" not found.\n\nAvailable templates: ${available}\n\nUse the template list tool to see all options.`,
            ).toErr();
          }

          try {
            const templateXml = templateXmlSource;
            const workbookXml = readFileSync(resolve(workbookFile), 'utf-8');

            // Per-apply calc namespacing identity: the shared core defaults
            // namespacing OFF and never mints its own nonce, so the caller supplies
            // one. The sidecar uses session for cache fingerprinting; this nonce is
            // target workbook file + apply timestamp; a randomUUID guards against
            // same-millisecond collisions.
            // Manifest enforcement (P0 W-23447710): a caller-supplied mapping for a
            // manifest-backed template is validated/corrected through the binder
            // contract — slot derivations come from the manifest, not the caller.
            let appliedFieldMapping = fieldMapping;
            let appliedTemplateParameters = templateParameters;
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
                { title, datasource: templateParameters.DATASOURCE },
              );

              if (!explicitBind.ok) {
                return new ArgsValidationError(
                  formatExplicitBindErrors(templateName, explicitBind.errors),
                ).toErr();
              }

              const resolvedDatasource =
                explicitBind.passthrough && fieldMapping
                  ? (inferSingleDatasourceFromFieldMapping(fieldMapping) ?? explicitBind.datasource)
                  : explicitBind.datasource;

              if (resolvedDatasource !== templateParameters.DATASOURCE) {
                return new ArgsValidationError(
                  `Explicit template binding BLOCKED for "${templateName}". No worksheet was produced.\n\n` +
                    `  • [datasource-mismatch] caller DATASOURCE "${templateParameters.DATASOURCE}" does not match resolved mapping datasource "${resolvedDatasource}".\n` +
                    `    FIX: Set templateParameters.DATASOURCE to "${resolvedDatasource}" and retry with the same fieldMapping.`,
                ).toErr();
              }

              if (!explicitBind.passthrough) appliedFieldMapping = explicitBind.fieldMapping;
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
              insertPosition,
              relativeSheetName,
              applyNonce,
            });

            if (!result.ok) {
              return new XmlValidationError(result.issues).toErr();
            }

            writeFileSync(resolve(workbookFile), result.xml, 'utf-8');
            writeSidecar(resolve(workbookFile), session);

            return new Ok({
              workbookFile,
              templateName,
              title,
              sheetType,
              warnings: explicitTemplateWarnings,
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
