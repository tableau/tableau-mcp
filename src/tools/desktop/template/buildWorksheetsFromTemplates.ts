import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { randomUUID } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import {
  bindExplicitTemplate,
  formatExplicitBindErrors,
} from '../../../desktop/binder/explicit-bind.js';
import { summarizeSchema } from '../../../desktop/binder/schema-summary.js';
import { loadWorksheetXml } from '../../../desktop/commands/workbook/loadWorksheetXml.js';
import { emitWorksheetPromiseEvents } from '../../../desktop/episode-events.js';
import { parseDatasourceQualifiedColumnRef } from '../../../desktop/metadata/field-resolver.js';
import { extractSheetXml } from '../../../desktop/metadata/sheets.js';
import { resolveSession } from '../../../desktop/sessionResolution.js';
import { buildInjectedWorkbookXml } from '../../../desktop/templates/injectTemplateCore.js';
import type { OptionalFieldPruneSpec } from '../../../desktop/templates/optionalFieldPrune.js';
import { listTemplateNames, readTemplate } from '../../../desktop/templates/templatePath.js';
import {
  resolveAllTemplateManifests,
  resolveTemplateManifest,
} from '../../../desktop/templates/templateSlots.js';
import {
  classifyWorksheetPromiseOutcome,
  formatWorksheetPromiseCheck,
} from '../../../desktop/validation/promise-check.js';
import { formatReadbackVerificationWarnings } from '../../../desktop/validation/readback-verify.js';
import {
  ArgsValidationError,
  DesktopCommandExecutionError,
  FileNotFoundError,
  FileReadError,
  WorksheetXmlLoadFailedError,
  XmlValidationError,
} from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { DesktopTool } from '../tool.js';

const paramsSchema = {
  session: z.string().optional().describe(''),
  workbookFile: z.string().describe(''),
  templateName: z.string().describe(''),
  title: z.string().describe(''),
  datasource: z.string().describe(''),
  fieldMapping: z
    .record(z.string())
    .describe(
      "Map each slot id to a field: a plain column ref [ds].[Sales] when the slot's derivation is 'none', else a column instance [ds].[sum:Sales:qk] for an aggregated slot.",
    ),
  mode: z.enum(['buildAndReturn', 'buildAndApply']).describe(''),
  insertAfter: z.string().optional().describe(''),
};

/**
 * Metadata-optional, deterministic worksheet constructor: fill a template's slots with a
 * caller-supplied field mapping and either RETURN the built worksheet for review
 * (`buildAndReturn`) or upsert it into the live workbook (`buildAndApply`, via the same
 * apply-worksheet seam — {@link loadWorksheetXml}). Unlike inject-template it routes every
 * manifest through {@link resolveAllTemplateManifests}/{@link resolveTemplateManifest}, so a
 * `.tbm` dropped in with NO curated manifest is fully buildable from its inferred slots.
 */
interface BuildSuccess {
  mode: 'buildAndReturn' | 'buildAndApply';
  templateName: string;
  title: string;
  /** The built worksheet fragment — streamed back in buildAndReturn, carried in buildAndApply. */
  worksheetXml: string;
  warnings: string[];
  /** buildAndApply-only honest host-verification tails (empty otherwise). */
  readbackWarning: string;
  receipt: string;
}

function inferSingleDatasourceFromFieldMapping(
  fieldMapping: Record<string, string>,
): string | null {
  const datasources = new Set<string>();
  for (const ref of Object.values(fieldMapping)) {
    const datasource = parseDatasourceQualifiedColumnRef(ref.trim())?.datasource;
    if (datasource) datasources.add(datasource);
  }
  return datasources.size === 1 ? [...datasources][0] : null;
}

const toolTitle = 'Build Worksheets From Templates';
export const getBuildWorksheetsFromTemplatesTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const tool = new DesktopTool({
    server,
    name: 'build-worksheets-from-templates',
    title: toolTitle,
    description:
      "Fill a template's slots with your datasource fields to build a worksheet, then either return it for review or upsert it into the live workbook.",
    paramsSchema,
    annotations: {
      title: toolTitle,
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    callback: async (
      { session, workbookFile, templateName, title, datasource, fieldMapping, mode, insertAfter },
      extra,
    ): Promise<CallToolResult> => {
      return await tool.logAndExecute({
        extra,
        args: {
          session,
          workbookFile,
          templateName,
          title,
          datasource,
          fieldMapping,
          mode,
          insertAfter,
        },
        callback: async () => {
          if (!existsSync(resolve(workbookFile))) {
            return new FileNotFoundError(workbookFile).toErr();
          }

          const templateXml = readTemplate(templateName);
          if (templateXml === null) {
            const files = listTemplateNames();
            const available = files.length > 0 ? files.join(', ') : 'none';
            return new ArgsValidationError(
              `Template "${templateName}" not found.\n\nAvailable templates: ${available}\n\nUse the template list tool to see all options.`,
            ).toErr();
          }

          let workbookXml: string;
          try {
            workbookXml = readFileSync(resolve(workbookFile), 'utf-8');
          } catch (err) {
            return new FileReadError(err).toErr();
          }

          // Metadata-optional binding: the binder is handed the FULL resolved catalog so a
          // `.tbm`-only template (no curated manifest) still binds against its inferred slots.
          const manifests = resolveAllTemplateManifests();
          let appliedFieldMapping = fieldMapping;
          let optionalFieldPrunes: OptionalFieldPruneSpec[] = [];
          const warnings: string[] = [];
          if (fieldMapping && Object.keys(fieldMapping).length > 0) {
            const explicitBind = bindExplicitTemplate(
              templateName,
              fieldMapping,
              summarizeSchema(workbookXml),
              { title, datasource, manifests },
            );

            if (!explicitBind.ok) {
              return new ArgsValidationError(
                formatExplicitBindErrors(templateName, explicitBind.errors),
              ).toErr();
            }

            const resolvedDatasource = explicitBind.passthrough
              ? (inferSingleDatasourceFromFieldMapping(fieldMapping) ?? explicitBind.datasource)
              : explicitBind.datasource;

            if (resolvedDatasource !== datasource) {
              return new ArgsValidationError(
                `Template binding BLOCKED for "${templateName}". No worksheet was produced.\n\n` +
                  `  • [datasource-mismatch] caller datasource "${datasource}" does not match resolved mapping datasource "${resolvedDatasource}".\n` +
                  `    FIX: Set datasource to "${resolvedDatasource}" and retry with the same fieldMapping.`,
              ).toErr();
            }

            if (!explicitBind.passthrough) appliedFieldMapping = explicitBind.fieldMapping;
            optionalFieldPrunes = explicitBind.optionalFieldPrunes;
            warnings.push(...explicitBind.warnings);
          }

          const applyNonce = `${workbookFile}:${Date.now()}:${randomUUID()}`;
          const built = buildInjectedWorkbookXml({
            workbookXml,
            templateXml,
            title,
            sheetType: 'worksheet',
            templateParameters: { DATASOURCE: datasource },
            fieldMapping: appliedFieldMapping,
            // Metadata-optional slots: the merged manifest (inferred + any curated overlay),
            // NOT the curated-only provider inject-template reads.
            templateSlots: resolveTemplateManifest(templateName)?.manifest.slots,
            insertPosition: insertAfter ? 'after_sheet' : 'end',
            relativeSheetName: insertAfter,
            applyNonce,
            optionalFieldPrunes,
          });

          if (!built.ok) {
            return new XmlValidationError(built.issues).toErr();
          }

          // The built workbook holds exactly the one sheet we asked for; extract it so both
          // modes speak the standalone-worksheet contract the apply seam expects.
          const worksheetXml = extractSheetXml(built.xml, title);
          if (!worksheetXml) {
            return new XmlValidationError([
              `Built workbook did not contain a worksheet named "${title}".`,
            ]).toErr();
          }

          if (mode === 'buildAndReturn') {
            return new Ok<BuildSuccess>({
              mode,
              templateName,
              title,
              worksheetXml,
              warnings,
              readbackWarning: '',
              receipt: '',
            });
          }

          // buildAndApply — upsert through the same seam apply-worksheet uses.
          const sessionResult = resolveSession(session);
          if (sessionResult.isErr()) {
            return sessionResult.error.toErr();
          }
          const resolvedSession = sessionResult.value;
          const executor = await extra.getExecutor(resolvedSession);
          const result = await loadWorksheetXml({
            worksheetName: title,
            xml: worksheetXml,
            executor,
            signal: extra.signal,
          });

          if (result.isErr()) {
            const { type, error } = result.error;
            switch (type) {
              case 'execute-command-error':
                return new DesktopCommandExecutionError(error).toErr();
              case 'load-worksheet-xml-error':
                return new WorksheetXmlLoadFailedError(error).toErr();
              default: {
                const _: never = type;
              }
            }
          }

          // Honest host-verification tails, mirroring apply-worksheet — the receipt line is
          // host-derived (preflight + readback), never model-filled.
          const readbackWarning = result.isOk()
            ? formatReadbackVerificationWarnings(result.value.readbackWarnings)
            : '';
          const receiptInput = result.isOk()
            ? {
                validationWarnings: result.value.validationWarnings ?? [],
                readback: result.value.readbackVerification,
                readbackFindings: result.value.readbackWarnings,
              }
            : undefined;
          const promiseOutcome = receiptInput
            ? classifyWorksheetPromiseOutcome(receiptInput)
            : 'unverified';
          if (result.isOk()) {
            await emitWorksheetPromiseEvents({
              config: extra.config,
              sessionId: resolvedSession,
              tool: 'build-worksheets-from-templates',
              operation: 'load-worksheet',
              readback: result.value.readbackVerification,
              findings: result.value.readbackWarnings,
              promiseOutcome,
            });
          }
          const receipt = receiptInput ? formatWorksheetPromiseCheck(receiptInput) : '';

          return new Ok<BuildSuccess>({
            mode,
            templateName,
            title,
            worksheetXml,
            warnings,
            readbackWarning,
            receipt,
          });
        },
        getSuccessResult: (value) => {
          const { templateName, title, warnings } = value;
          const advisory =
            warnings.length > 0
              ? `\n\nTemplate advisory warnings:\n${warnings.map((w) => `  - ${w}`).join('\n')}`
              : '';

          if (value.mode === 'buildAndReturn') {
            return {
              content: [
                {
                  type: 'text',
                  text:
                    `Built "${title}" from template "${templateName}". ` +
                    'The workbook file was NOT modified. The filled worksheet follows.' +
                    advisory +
                    `\n\n${value.worksheetXml}`,
                },
              ],
            };
          }

          return {
            content: [
              {
                type: 'text',
                text:
                  `Built "${title}" from template "${templateName}" and applied it to the live workbook.` +
                  advisory +
                  value.readbackWarning +
                  value.receipt,
              },
            ],
          };
        },
      });
    },
  });
  return tool;
};
