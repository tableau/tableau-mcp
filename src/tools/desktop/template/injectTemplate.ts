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
import { resolveSession } from '../../../desktop/sessionResolution.js';
import { buildInjectedWorkbookXml } from '../../../desktop/templates/injectTemplateCore.js';
import type { OptionalFieldPruneSpec } from '../../../desktop/templates/optionalFieldPrune.js';
import { getRuntimeTemplateSnapshot } from '../../../desktop/templates/runtimeTemplateCatalog.js';
import { listTemplateNames } from '../../../desktop/templates/templatePath.js';
import {
  ArgsValidationError,
  FileNotFoundError,
  FileReadError,
  XmlValidationError,
} from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { DesktopTool } from '../tool.js';

// session is optional like the other 50 tools. Required + a pin the agent cannot name is an
// impossible contract: pass the pinned pid and the guard says omit it, omit it and the
// schema says required. resolveSession(undefined) falls back to the pin (or the sole running
// Desktop), which is what the sidecar has always been stamped with anyway.
const paramsSchema = {
  session: z
    .string()
    .optional()
    .describe('Desktop process ID; omit to use the pinned or only running instance.'),
  workbookFile: z.string().describe('Cached workbook path from field resolution.'),
  templateName: z.string().describe('ID of an existing template.'),
  title: z.string().describe('Name for the sheet this creates.'),
  sheetType: z.enum(['worksheet', 'dashboard', 'story']).describe('What the template builds.'),
  templateParameters: z
    .record(z.string())
    .optional()
    .describe('Placeholder values required by the selected template (e.g. DATASOURCE).'),
  fieldMapping: z
    .record(z.string())
    .optional()
    .describe('Slot to qualified ref from field resolution, never invented.'),
  insertPosition: z
    .enum(['end', 'before_sheet', 'after_sheet'])
    .optional()
    .describe('end (default), or before_sheet/after_sheet next to relativeSheetName.'),
  relativeSheetName: z
    .string()
    .optional()
    .describe('Existing sheet name; omit when insertPosition defaults to end.'),
};

const toolTitle = 'Adding template';
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
          const sessionResult = resolveSession(session);
          if (sessionResult.isErr()) {
            return sessionResult.error.toErr();
          }
          const resolvedSession = sessionResult.value;

          if (!existsSync(resolve(workbookFile))) {
            return new FileNotFoundError(workbookFile).toErr();
          }

          const runtimeSnapshot = getRuntimeTemplateSnapshot(templateName);
          if (runtimeSnapshot === null) {
            const files = listTemplateNames();
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
            // one. The sidecar uses session for cache fingerprinting; this nonce is
            // target workbook file + apply timestamp; a randomUUID guards against
            // same-millisecond collisions.
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
            writeSidecar(resolve(workbookFile), resolvedSession);

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
