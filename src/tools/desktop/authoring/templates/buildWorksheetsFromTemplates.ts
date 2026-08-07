import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { randomUUID } from 'crypto';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import {
  bindExplicitTemplate,
  formatExplicitBindErrors,
} from '../../../../desktop/binder/explicit-bind.js';
import { summarizeSchema } from '../../../../desktop/binder/schema-summary.js';
import { extractSheetXml, extractWorksheetWindowXml } from '../../../../desktop/metadata/sheets.js';
import { captureTargetWorksheetState } from '../../../../desktop/metadata/targetWorksheetState.js';
import { resolveSession } from '../../../../desktop/session/sessionResolution.js';
import { buildInjectedWorkbookXml } from '../../../../desktop/templates/injectTemplateCore.js';
import {
  getTemplateArtifactStore,
  type TemplateArtifactStore,
} from '../../../../desktop/templates/templateArtifactStore.js';
import {
  getTemplateCatalogEntry,
  readBookmarkFromCatalogEntry,
} from '../../../../desktop/templates/templatePath.js';
import { createTemplateRuntimeSnapshot } from '../../../../desktop/templates/templateRuntimeSnapshot.js';
import {
  ArgsValidationError,
  DesktopCommandExecutionError,
  FileReadError,
  XmlValidationError,
} from '../../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../../server.desktop.js';
import { jsonToolResult } from '../../structuredContent.js';
import { DesktopTool } from '../../tool.js';

const MAX_BINDINGS = 32;

const paramsSchema = {
  session: z.string().optional().describe('Desktop process ID; omit for the current instance.'),
  templateName: z.string().trim().min(1).max(128).describe('Worksheet template ID.'),
  title: z.string().trim().min(1).max(255).describe('Worksheet name to build.'),
  datasource: z.string().trim().min(1).max(255).describe('Live datasource name.'),
  fieldMapping: z
    .record(z.string().trim().min(1).max(128), z.string().trim().min(1).max(255))
    .describe('Template slot ID to live field reference.'),
};

interface BuildWorksheetsFromTemplatesDependencies {
  store: TemplateArtifactStore;
  createId(): string;
}

export const getBuildWorksheetsFromTemplatesTool = (
  server: DesktopMcpServer,
  dependencies: Partial<BuildWorksheetsFromTemplatesDependencies> = {},
): DesktopTool<typeof paramsSchema> => {
  const store = dependencies.store ?? getTemplateArtifactStore(server);
  const createId = dependencies.createId ?? randomUUID;
  const tool = new DesktopTool({
    server,
    name: 'build-worksheets-from-templates',
    title: 'Building template worksheet',
    description: 'Build one worksheet artifact without changing Desktop.',
    paramsSchema,
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
      destructiveHint: false,
      idempotentHint: false,
    },
    callback: async (
      { session, templateName, title, datasource, fieldMapping },
      extra,
    ): Promise<CallToolResult> => {
      return await tool.logAndExecute({
        extra,
        args: { session, templateName, title, datasource, fieldMapping },
        getSuccessResult: (payload) => jsonToolResult(payload, { isError: false }),
        callback: async () => {
          const bindingEntries = Object.entries(fieldMapping);
          if (bindingEntries.length === 0 || bindingEntries.length > MAX_BINDINGS) {
            return new ArgsValidationError(
              `fieldMapping must contain 1-${MAX_BINDINGS} template slot bindings.`,
            ).toErr();
          }

          const sessionResult = resolveSession(session);
          if (sessionResult.isErr()) return sessionResult.error.toErr();
          const resolvedSession = sessionResult.value;
          const executor = await extra.getExecutor(resolvedSession);
          const workbookResult = await executor.getWorkbookDocument(extra.signal);
          if (workbookResult.isErr()) {
            return new DesktopCommandExecutionError(workbookResult.error).toErr();
          }
          const workbookXml = workbookResult.value.xml;
          const instanceId = workbookResult.value.instanceId;
          if (!instanceId) {
            return new DesktopCommandExecutionError({
              type: 'invalid-response',
              error: new Error('Workbook read did not identify its External Client API instance.'),
            }).toErr();
          }

          let entry;
          try {
            entry = getTemplateCatalogEntry(templateName);
          } catch (error) {
            return new ArgsValidationError(
              error instanceof Error ? error.message : String(error),
            ).toErr();
          }
          if (!entry || entry.discoveryIssue) {
            return new ArgsValidationError(`Template "${templateName}" is not available.`).toErr();
          }

          const bookmarkXml = readBookmarkFromCatalogEntry(entry);
          if (bookmarkXml === null) {
            return new ArgsValidationError(`Template "${templateName}" could not be read.`).toErr();
          }

          try {
            const snapshot = createTemplateRuntimeSnapshot(templateName, bookmarkXml);
            if (!snapshot.eligibility.pass1_eligible) {
              return new ArgsValidationError(
                `Template "${templateName}" is not eligible for worksheet template application.`,
              ).toErr();
            }

            const explicitBind = bindExplicitTemplate(
              templateName,
              fieldMapping,
              summarizeSchema(workbookXml),
              { contract: snapshot.descriptor, title, datasource },
            );
            if (!explicitBind.ok) {
              return new ArgsValidationError(
                formatExplicitBindErrors(templateName, explicitBind.errors),
              ).toErr();
            }
            if (explicitBind.datasource !== datasource) {
              return new ArgsValidationError(
                `Datasource "${datasource}" does not match the bound datasource "${explicitBind.datasource}".`,
              ).toErr();
            }

            const artifactId = createId();
            const injected = buildInjectedWorkbookXml({
              workbookXml,
              templateXml: snapshot.xml,
              title,
              sheetType: 'worksheet',
              templateParameters: { DATASOURCE: datasource },
              fieldMapping: explicitBind.fieldMapping,
              templateSlots: explicitBind.templateSlots,
              fieldMetadata: explicitBind.fieldMetadata,
              applyNonce: artifactId,
              optionalFieldPrunes: explicitBind.optionalFieldPrunes,
            });
            if (!injected.ok) return new XmlValidationError(injected.issues).toErr();

            const worksheetXml = extractSheetXml(injected.xml, title);
            const windowXml = extractWorksheetWindowXml(injected.xml, title);
            if (!worksheetXml || !windowXml) {
              return new ArgsValidationError(
                `Template "${templateName}" did not produce a complete worksheet artifact.`,
              ).toErr();
            }

            const stored = store.put({
              id: artifactId,
              sessionId: resolvedSession,
              instanceId,
              templateName,
              templateSourceHash: snapshot.sourceHash,
              title,
              datasource,
              fieldMapping: explicitBind.fieldMapping,
              worksheetXml,
              windowXml,
              targetState: captureTargetWorksheetState(workbookXml, title, worksheetXml),
            });
            if (!stored.ok) {
              return new ArgsValidationError(
                'Template artifact capacity is busy. Apply or release an in-use artifact, then retry.',
              ).toErr();
            }

            return Ok({
              artifactId,
              templateName,
              title,
              datasource,
              provenance: entry.provenance,
              bindings: explicitBind.templateSlots
                .map((slot) => {
                  const mappingKey = slot.qualified_key_required
                    ? `${slot.template_field}@${slot.derivation}`
                    : slot.template_field;
                  return {
                    slotId: slot.slot_id,
                    field: explicitBind.fieldMapping[mappingKey],
                  };
                })
                .filter(
                  (binding): binding is { slotId: string; field: string } =>
                    binding.field !== undefined,
                )
                .map((slot) => ({
                  slotId: slot.slotId,
                  field: slot.field,
                })),
            });
          } catch (error) {
            return new FileReadError(error).toErr();
          }
        },
      });
    },
  });
  return tool;
};
