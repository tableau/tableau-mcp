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
import { bundledIntelligenceProvider } from '../../../desktop/intelligence/provider.js';
import { parseDatasourceQualifiedColumnRef } from '../../../desktop/metadata/field-resolver.js';
import { resolveSession } from '../../../desktop/sessionResolution.js';
import { buildInjectedWorkbookXml } from '../../../desktop/templates/injectTemplateCore.js';
import type { OptionalFieldPruneSpec } from '../../../desktop/templates/optionalFieldPrune.js';
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
  // LEG 4 (DELIVER): an agent can either apply the filled worksheet to the workbook
  // ('inject', default — writes the file and expects a follow-up apply-workbook) or
  // receive the filled worksheet XML directly ('xml' — returns the injected workbook
  // XML as tool content, writes NOTHING). Both modes run the SAME build + residue
  // guards (they live inside buildInjectedWorkbookXml → rewriteFieldReferences), so
  // 'xml' can never stream a worksheet carrying live {{field_base_N}} tokens or an
  // unresolved required slot. Default preserves every existing caller's behavior.
  output: z.enum(['inject', 'xml']).default('inject').describe(''),
};

/**
 * Success payload shared by both output modes so `logAndExecute<T>` infers a single
 * `T` (a union of literal `mode`s would otherwise lock onto whichever branch it sees
 * first). `mode` discriminates in getSuccessResult; `xml` is always the built workbook
 * XML (streamed back in 'xml' mode, carried but unused in 'inject' mode).
 */
interface InjectSuccess {
  mode: 'inject' | 'xml';
  workbookFile: string;
  templateName: string;
  title: string;
  sheetType: 'worksheet' | 'dashboard' | 'story';
  warnings: string[];
  xml: string;
}

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
    description: 'Inject a template.',
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
        output,
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
          output,
        },
        callback: async () => {
          const sessionResult = resolveSession(session);
          if (sessionResult.isErr()) {
            return sessionResult.error.toErr();
          }
          const resolvedSession = sessionResult.value;

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
              templateSlots: bundledIntelligenceProvider.getTemplateManifest(templateName)?.slots,
              insertPosition,
              relativeSheetName,
              applyNonce,
              optionalFieldPrunes,
            });

            if (!result.ok) {
              return new XmlValidationError(result.issues).toErr();
            }

            // LEG 4 fork. 'xml' streams the filled worksheet XML back to the agent and
            // touches nothing on disk; 'inject' (default) writes the workbook + sidecar
            // exactly as before. The residue/well-formedness guards already ran inside
            // buildInjectedWorkbookXml, so the streamed XML carries no live tokens.
            if (output === 'xml') {
              return new Ok<InjectSuccess>({
                mode: 'xml',
                workbookFile,
                templateName,
                title,
                sheetType,
                warnings: explicitTemplateWarnings,
                xml: result.xml,
              });
            }

            writeFileSync(resolve(workbookFile), result.xml, 'utf-8');
            writeSidecar(resolve(workbookFile), resolvedSession);

            return new Ok<InjectSuccess>({
              mode: 'inject',
              workbookFile,
              templateName,
              title,
              sheetType,
              warnings: explicitTemplateWarnings,
              xml: result.xml,
            });
          } catch (err) {
            return new FileReadError(err).toErr();
          }
        },
        getSuccessResult: (value) => {
          const { templateName, title, sheetType, warnings } = value;
          const advisory =
            warnings.length > 0
              ? `\n\nTemplate advisory warnings:\n${warnings.map((w) => `  - ${w}`).join('\n')}`
              : '';

          if (value.mode === 'xml') {
            // Return the filled worksheet XML as the tool payload; the workbook file
            // is untouched (the agent chose to receive the XML, not apply it).
            return {
              content: [
                {
                  type: 'text',
                  text:
                    `Built template "${templateName}" as "${title}" (${sheetType}). ` +
                    'The workbook file was NOT modified. The filled worksheet XML follows.' +
                    advisory +
                    `\n\n${value.xml}`,
                },
              ],
            };
          }

          return {
            content: [
              {
                type: 'text',
                text:
                  `Injected template "${templateName}" as "${title}" (${sheetType}).` +
                  advisory +
                  `\n\nUpdated file: ${value.workbookFile}\n\nUse apply-workbook to apply changes to Tableau.`,
              },
            ],
          };
        },
      });
    },
  });
  return tool;
};
