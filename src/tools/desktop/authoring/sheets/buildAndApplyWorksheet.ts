import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { randomUUID } from 'crypto';
import levenshtein from 'fast-levenshtein';
import { existsSync, readFileSync } from 'fs';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import {
  bindExplicitTemplate,
  formatExplicitBindErrors,
  schemaSummaryFromAvailableFields,
} from '../../../../desktop/binder/explicit-bind.js';
import type { SlotSpec } from '../../../../desktop/binder/manifest-types.js';
import { emitWorksheetPromiseEvents } from '../../../../desktop/episode-events.js';
import type { ExternalApiToolExecutor } from '../../../../desktop/externalApi/executorTypes.js';
import {
  parseColumnInstanceRef,
  parseDatasourceQualifiedColumnRef,
} from '../../../../desktop/metadata/field-resolver.js';
import { listAvailableFields } from '../../../../desktop/metadata/index.js';
import { resolveSession } from '../../../../desktop/session/sessionResolution.js';
import { spliceBoundFacet } from '../../../../desktop/templates/facetSplice.js';
import { rewriteFieldReferencesWithDiagnostics } from '../../../../desktop/templates/fieldReferenceRewriter.js';
import { spliceBoundCalcDefinitions } from '../../../../desktop/templates/groupDefinitionSplice.js';
import { ensureUserNamespace } from '../../../../desktop/templates/injectTemplateCore.js';
import { pruneUnboundOptionalFields } from '../../../../desktop/templates/optionalFieldPrune.js';
import { getRuntimeTemplateSnapshot } from '../../../../desktop/templates/runtimeTemplateCatalog.js';
import { listTemplateNames } from '../../../../desktop/templates/templatePath.js';
import {
  classifyWorksheetPromiseOutcome,
  formatWorksheetPromiseCheck,
} from '../../../../desktop/validation/promise-check.js';
import { checkSidecar } from '../../../../desktop/wrappers/cacheFingerprint.js';
import { getWorkbookXml } from '../../../../desktop/wrappers/getWorkbookXml.js';
import { loadWorksheetXml } from '../../../../desktop/wrappers/loadWorksheetXml.js';
import {
  ArgsValidationError,
  CacheSessionMismatchError,
  DesktopCommandExecutionError,
  FileNotFoundError,
  WorksheetXmlLoadFailedError,
} from '../../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../../server.desktop.js';
import { DesktopTool } from '../../tool.js';

function getSuccessResult(result: unknown): CallToolResult {
  return {
    isError: false,
    content: [{ type: 'text', text: JSON.stringify(result) }],
  };
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

type AvailableField = ReturnType<typeof listAvailableFields>[number];

type RequestedFieldResolution =
  | { ok: true; requested: string; columnRef: string; field: AvailableField }
  | { ok: false; requested: string; reason: string };

function bareFieldName(name: string): string {
  return name.replace(/^\[|\]$/g, '').trim();
}

function foldedName(name: string): string {
  return bareFieldName(name).toLowerCase();
}

/**
 * Resolve the caller forms accepted by bind-template (caption, local name, or
 * column_ref) before the legacy role grouping runs. Never choose arbitrarily
 * when duplicate captions/local names span datasources.
 */
function resolveRequestedField(
  requested: string,
  availableFields: AvailableField[],
): RequestedFieldResolution {
  const trimmed = requested.trim();
  const exactRef = availableFields.find((field) => field.column_ref === trimmed);
  if (exactRef) {
    return { ok: true, requested, columnRef: exactRef.column_ref, field: exactRef };
  }

  const qualified = parseDatasourceQualifiedColumnRef(trimmed);
  if (qualified) {
    const instance = parseColumnInstanceRef(qualified.columnInstanceName);
    const matches = instance
      ? availableFields.filter(
          (field) =>
            field.datasource === qualified.datasource &&
            bareFieldName(field.columnName) === instance.localFieldName,
        )
      : [];
    if (matches.length === 1) {
      return {
        ok: false,
        requested,
        reason: `its exact column_ref is not present; nearest valid column_ref is "${matches[0].column_ref}"`,
      };
    }
    return {
      ok: false,
      requested,
      reason:
        matches.length > 1
          ? `its column_ref base matches ${matches.length} fields`
          : 'its exact column_ref is not present',
    };
  }

  const bareRequested = bareFieldName(trimmed);
  const exactNamedMatches = availableFields.filter(
    (field) =>
      field.caption?.trim() === trimmed ||
      field.caption?.trim() === bareRequested ||
      bareFieldName(field.columnName) === bareRequested,
  );
  if (exactNamedMatches.length === 1) {
    const field = exactNamedMatches[0];
    return { ok: true, requested, columnRef: field.column_ref, field };
  }
  if (exactNamedMatches.length > 1) {
    return {
      ok: false,
      requested,
      reason: `its caption/local name is ambiguous across ${exactNamedMatches.length} fields`,
    };
  }

  const foldedRequested = foldedName(trimmed);
  const foldedMatches = availableFields.filter(
    (field) =>
      (field.caption !== undefined && foldedName(field.caption) === foldedRequested) ||
      foldedName(field.columnName) === foldedRequested,
  );
  if (foldedMatches.length === 1) {
    const field = foldedMatches[0];
    return { ok: true, requested, columnRef: field.column_ref, field };
  }
  return {
    ok: false,
    requested,
    reason:
      foldedMatches.length > 1
        ? `its caption/local name is ambiguous across ${foldedMatches.length} fields`
        : 'no caption, local name, or exact column_ref matches',
  };
}

function droppedFieldWarning({
  requested,
  reason,
}: Extract<RequestedFieldResolution, { ok: false }>): string {
  return (
    `Field "${requested}" was dropped: ${reason}. ` +
    'Use list-available-fields or resolve-field, then retry with an exact column_ref.'
  );
}

function quotedFields(fields: string[]): string {
  return fields.map((field) => JSON.stringify(field)).join(', ');
}

function formatDroppedFieldsReceipt(droppedFields: string[], requestedCount: number): string {
  return (
    '\n\nHOST VERIFICATION — failed: apply completed · requested field coverage FAILED ' +
    `(${droppedFields.length}/${requestedCount} dropped: ${quotedFields(droppedFields)}). ` +
    'Readback cannot verify omitted fields; do not report full worksheet success.'
  );
}

function manifestRoleSlotCount(slots: readonly SlotSpec[], role: 'dimension' | 'measure'): number {
  return slots.filter((slot) => {
    if (!slot.bindable) return false;
    if (role === 'measure') return slot.kind === 'quantitative';
    return slot.kind === 'categorical' || slot.kind === 'temporal' || slot.kind === 'geo';
  }).length;
}

// Resolve membership at callback time so mounted/user templates work without rebuilding
// the MCP schema, and so tools/list does not embed the whole catalog.
function safeListTemplateNames(): string[] {
  try {
    const names = listTemplateNames();
    return Array.isArray(names) ? names : [];
  } catch {
    return [];
  }
}

const templateSchema = z.string().min(1).max(160);

const MAX_TEMPLATE_SUGGESTIONS = 3;

/** Nearest real template names for an id that did not resolve (same shape as commandNameRegistry). */
function suggestTemplateText(template: string): string {
  const names = safeListTemplateNames();
  if (names.length === 0) {
    return '';
  }
  const normalized = template.toLowerCase().replace(/[^a-z0-9]/g, '');
  const suggestions = names
    .map((candidate) => ({
      candidate,
      distance: levenshtein.get(normalized, candidate.toLowerCase().replace(/[^a-z0-9]/g, '')),
    }))
    .sort((a, b) => a.distance - b.distance || a.candidate.localeCompare(b.candidate))
    .slice(0, MAX_TEMPLATE_SUGGESTIONS)
    .map(({ candidate }) => candidate);
  return ` Did you mean: ${suggestions.join(', ')}?`;
}

const paramsSchema = {
  session: z.string().optional(),
  taskSpec: z.object({
    worksheetName: z.string(),
    template: templateSchema.optional(),
    fields: z.array(z.string()),
    workbookFile: z.string().optional().describe('Cache path; omit to fetch current workbook.'),
  }),
};

const toolTitle = 'Building worksheet';
export const getBuildAndApplyWorksheetTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const tool = new DesktopTool({
    server,
    name: 'build-and-apply-worksheet',
    title: toolTitle,
    description: 'Build a worksheet from a spec and apply it in one validated call.',
    paramsSchema,
    annotations: {
      readOnlyHint: false,
      openWorldHint: false,
      destructiveHint: true,
      idempotentHint: false,
    },
    callback: async ({ session, taskSpec }, extra): Promise<CallToolResult> => {
      return await tool.logAndExecute({
        extra,
        args: { session, taskSpec },
        getSuccessResult,
        callback: async () => {
          const { worksheetName, workbookFile, template, fields } = taskSpec;

          if (workbookFile !== undefined && !existsSync(workbookFile)) {
            return new FileNotFoundError(workbookFile).toErr();
          }

          if (!template) {
            return new ArgsValidationError(
              'taskSpec.template is required. KPIs default to "kpi-text"; viz worksheets should use a viz-specific template (e.g., "ranking-ordered-bar"). Re-run plan-dashboard-creation to get a plan with templates populated.',
            ).toErr();
          }

          let runtimeSnapshot: ReturnType<typeof getRuntimeTemplateSnapshot>;
          try {
            runtimeSnapshot = getRuntimeTemplateSnapshot(template);
          } catch {
            runtimeSnapshot = null;
          }
          if (!runtimeSnapshot) {
            return new ArgsValidationError(
              `Template not found: "${template}".${suggestTemplateText(template)} Check available templates with the template list tool.`,
            ).toErr();
          }
          let templateXml = runtimeSnapshot.xml;

          const sessionResult = resolveSession(session);
          if (sessionResult.isErr()) {
            return sessionResult.error.toErr();
          }
          const resolvedSession = sessionResult.value;

          let executor: ExternalApiToolExecutor | undefined;
          let workbookXml: string;
          if (workbookFile !== undefined) {
            // Cross-instance cache-bleed guard (W9): refuse a cache produced by a different
            // (or restarted) Desktop session — its XML may not match the current workbook.
            const workbookSidecar = checkSidecar(workbookFile, resolvedSession, 'workbook');
            if (!workbookSidecar.ok) {
              return new CacheSessionMismatchError(workbookSidecar.message!).toErr();
            }
            workbookXml = readFileSync(workbookFile, 'utf-8');
          } else {
            executor = await extra.getExecutor(resolvedSession);
            const xmlResult = await getWorkbookXml({ executor, signal: extra.signal });
            if (xmlResult.isErr()) {
              return new DesktopCommandExecutionError(xmlResult.error).toErr();
            }
            workbookXml = xmlResult.value;
          }

          // Get available fields for role detection
          const availableFields = listAvailableFields(workbookXml);
          const schemaSummary = schemaSummaryFromAvailableFields(availableFields);

          // Resolve captions/local names to canonical refs before role grouping. The
          // old exact `column_ref === taskSpec field` check rejected the same friendly
          // field forms that bind-template emits and accepts.
          const warnings: string[] = [];
          const droppedRequestedFields: string[] = [];
          const resolvedFields: Array<Extract<RequestedFieldResolution, { ok: true }>> = [];
          for (const requested of fields) {
            const resolution = resolveRequestedField(requested, availableFields);
            if (resolution.ok) {
              resolvedFields.push(resolution);
            } else {
              droppedRequestedFields.push(requested);
              warnings.push(droppedFieldWarning(resolution));
            }
          }

          // Group resolved fields by role. Role values outside the supported pair are
          // treated as unresolved rather than silently routed to dimension.
          const unsupportedRoleFields = resolvedFields.filter(
            (resolution) =>
              resolution.field.role !== 'dimension' && resolution.field.role !== 'measure',
          );
          for (const dropped of unsupportedRoleFields) {
            droppedRequestedFields.push(dropped.requested);
            warnings.push(
              `Field "${dropped.requested}" was dropped: role "${dropped.field.role}" is not a supported dimension/measure role.`,
            );
          }

          const supportedResolvedFields = resolvedFields.filter(
            (resolution) => !unsupportedRoleFields.includes(resolution),
          );
          let appliedResolvedFields = supportedResolvedFields;

          if (fields.length > 0 && supportedResolvedFields.length === 0) {
            return new ArgsValidationError(
              `All requested fields were dropped: ${quotedFields(fields)}. No worksheet was applied.\n\n` +
                'FIX: Use list-available-fields or resolve-field, then retry with exact column_ref values for fields that fit the template roles.',
            ).toErr();
          }

          // The TBM-derived contract owns slot derivations and mapping keys.
          const explicitBind = bindExplicitTemplate(
            template,
            supportedResolvedFields.map((resolution) => resolution.columnRef),
            schemaSummary,
            {
              contract: runtimeSnapshot.descriptor,
              title: worksheetName,
              datasource: schemaSummary.datasource,
            },
          );

          if (!explicitBind.ok) {
            return new ArgsValidationError(
              formatExplicitBindErrors(template, explicitBind.errors),
            ).toErr();
          }

          warnings.push(...explicitBind.warnings);

          const consumedFieldRefs = new Set(explicitBind.consumedFieldRefs);
          const dimensionSlots = manifestRoleSlotCount(explicitBind.templateSlots, 'dimension');
          const measureSlots = manifestRoleSlotCount(explicitBind.templateSlots, 'measure');
          const unclaimedConsumedRefs = new Set(consumedFieldRefs);
          appliedResolvedFields = supportedResolvedFields.filter((resolution) =>
            unclaimedConsumedRefs.delete(resolution.columnRef),
          );
          const appliedResolutionSet = new Set(appliedResolvedFields);
          for (const dropped of supportedResolvedFields) {
            if (appliedResolutionSet.has(dropped)) continue;
            droppedRequestedFields.push(dropped.requested);
            if (dropped.field.role === 'dimension') {
              warnings.push(
                `Dimension field "${dropped.requested}" was dropped: template "${template}" exposes only ${dimensionSlots} dimension slot(s).`,
              );
            } else {
              warnings.push(
                `Measure field "${dropped.requested}" was dropped: template "${template}" exposes only ${measureSlots} measure slot(s).`,
              );
            }
          }

          const bindFields = appliedResolvedFields.map((resolution) => resolution.columnRef);
          if (fields.length > 0 && bindFields.length === 0) {
            return new ArgsValidationError(
              `All requested fields were dropped: ${quotedFields(fields)}. No worksheet was applied.\n\n` +
                'FIX: Use list-available-fields or resolve-field, then retry with exact column_ref values for fields that fit the template roles.',
            ).toErr();
          }

          const fieldMapping = explicitBind.fieldMapping;
          const rewriteDatasource = explicitBind.datasource;
          const fieldMetadata = explicitBind.fieldMetadata;

          // Inject title and replace field references. Per-apply calc namespacing is
          // wired at this tool boundary: the shared core defaults namespacing OFF and
          // never mints its own nonce, so derive one from session + apply timestamp
          // (randomUUID guards same-millisecond applies). Distinct nonces => distinct
          // calc-name suffixes => repeated applies into one workbook don't collide.
          templateXml = templateXml.replace(/\{\{TITLE\}\}/g, escapeXml(worksheetName));
          const applyNonce = `${resolvedSession}:${Date.now()}:${randomUUID()}`;
          // W28-C: splice a BOUND facet pill onto the trellis shelf BEFORE the frozen
          // core rewrite (identity no-op when no facet is bound). The core then maps
          // [Facet] → the bound field so the facet actually renders.
          templateXml = pruneUnboundOptionalFields(templateXml, explicitBind.optionalFieldPrunes);
          templateXml = ensureUserNamespace(templateXml);
          templateXml = spliceBoundFacet(templateXml, fieldMapping, explicitBind.templateSlots);
          const rewrite = rewriteFieldReferencesWithDiagnostics(
            templateXml,
            fieldMapping,
            rewriteDatasource,
            fieldMetadata,
            {
              namespaceCalcs: true,
              applyNonce,
              templateSlots: explicitBind.templateSlots,
            },
          );
          templateXml = rewrite.xml;
          warnings.push(...rewrite.droppedOptionalElements);
          templateXml = spliceBoundCalcDefinitions(templateXml, fieldMapping, workbookXml);
          // Extract worksheet element
          const worksheetMatch = templateXml.match(/<worksheet(?!s)[^>]*>[\s\S]*?<\/worksheet>/);
          if (!worksheetMatch) {
            return new ArgsValidationError(
              `Invalid template format: "${template}". Template must contain a <worksheet> element.`,
            ).toErr();
          }
          const worksheetXml = ensureUserNamespace(worksheetMatch[0]);

          // Apply to Tableau
          executor ??= await extra.getExecutor(resolvedSession);
          const signal = extra.signal;
          const applyResult = await loadWorksheetXml({
            worksheetName,
            xml: worksheetXml,
            focus: { navigate: 'artifact', sheetName: worksheetName },
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

          // Host verification receipt (W-23447506) — subsumes the old readback
          // status sentence: one host-truth line derived from preflight + readback.
          const receiptInput = applyResult.isOk()
            ? {
                validationWarnings: applyResult.value.validationWarnings ?? [],
                readback: applyResult.value.readbackVerification,
                readbackFindings: applyResult.value.readbackWarnings,
              }
            : undefined;
          const promiseOutcome = receiptInput
            ? droppedRequestedFields.length > 0
              ? 'failed'
              : classifyWorksheetPromiseOutcome(receiptInput)
            : 'unverified';
          if (applyResult.isOk()) {
            await emitWorksheetPromiseEvents({
              config: extra.config,
              sessionId: resolvedSession,
              tool: 'build-and-apply-worksheet',
              operation: 'load-worksheet',
              readback: applyResult.value.readbackVerification,
              findings: applyResult.value.readbackWarnings,
              promiseOutcome,
            });
          }
          const receipt =
            droppedRequestedFields.length > 0
              ? formatDroppedFieldsReceipt(droppedRequestedFields, fields.length)
              : receiptInput
                ? formatWorksheetPromiseCheck(receiptInput)
                : '';

          return new Ok({
            message:
              droppedRequestedFields.length > 0
                ? `WARNING — dropped requested field(s): ${quotedFields(droppedRequestedFields)}. Worksheet "${worksheetName}" was applied only with ${bindFields.length} of ${fields.length} requested fields using template "${template}".${receipt}`
                : `Built and applied worksheet "${worksheetName}" using template "${template}" with ${bindFields.length} fields.${receipt}`,
            worksheetName,
            template,
            fieldCount: bindFields.length,
            requestedFieldCount: fields.length,
            warnings,
          });
        },
      });
    },
  });
  return tool;
};
