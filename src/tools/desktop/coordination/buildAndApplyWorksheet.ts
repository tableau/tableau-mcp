import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { randomUUID } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import {
  bindExplicitTemplate,
  formatExplicitBindErrors,
  schemaSummaryFromAvailableFields,
} from '../../../desktop/binder/explicit-bind.js';
import type { SlotSpec } from '../../../desktop/binder/manifest-types.js';
import { checkSidecar } from '../../../desktop/commands/workbook/cacheFingerprint.js';
import { getWorkbookXml } from '../../../desktop/commands/workbook/getWorkbookXml.js';
import { loadWorksheetXml } from '../../../desktop/commands/workbook/loadWorksheetXml.js';
import { emitWorksheetPromiseEvents } from '../../../desktop/episode-events.js';
import {
  parseColumnInstanceRef,
  parseDatasourceQualifiedColumnRef,
} from '../../../desktop/metadata/field-resolver.js';
import { listAvailableFields } from '../../../desktop/metadata/index.js';
import {
  checkRouteGateForScratchEntry,
  type RouteGateResult,
} from '../../../desktop/route/route-gate.js';
import { resolveSession } from '../../../desktop/sessionResolution.js';
import { spliceBoundFacet } from '../../../desktop/templates/facetSplice.js';
import { rewriteFieldReferences } from '../../../desktop/templates/fieldReferenceRewriter.js';
import { ensureUserNamespace } from '../../../desktop/templates/injectTemplateCore.js';
import { pruneUnboundOptionalFields } from '../../../desktop/templates/optionalFieldPrune.js';
import { getTemplateColumnRequirements } from '../../../desktop/templates/templateColumnRequirements.js';
import { readTemplate } from '../../../desktop/templates/templatePath.js';
import { spliceWaterfallAnchorFilter } from '../../../desktop/templates/waterfallAnchorFilter.js';
import type { ToolExecutor } from '../../../desktop/toolExecutor/toolExecutor.js';
import {
  classifyWorksheetPromiseOutcome,
  formatWorksheetPromiseCheck,
} from '../../../desktop/validation/promise-check.js';
import {
  ArgsValidationError,
  CacheSessionMismatchError,
  DesktopCommandExecutionError,
  FileNotFoundError,
  WorksheetXmlLoadFailedError,
} from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { DesktopTool } from '../tool.js';

function isRouteGateResult(result: unknown): result is RouteGateResult {
  return (
    typeof result === 'object' &&
    result !== null &&
    Array.isArray((result as { content?: unknown }).content) &&
    typeof (result as { isError?: unknown }).isError === 'boolean'
  );
}

function getSuccessResult(result: unknown): CallToolResult {
  if (isRouteGateResult(result)) return result;
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

function inferSingleDatasourceFromColumnRefs(
  refs: string[],
): { ok: true; datasource: string | null } | { ok: false; message: string } {
  const refsByDatasource = new Map<string, string[]>();
  for (const ref of refs) {
    const datasource = parseDatasourceQualifiedColumnRef(ref.trim())?.datasource;
    if (!datasource) continue;
    refsByDatasource.set(datasource, [...(refsByDatasource.get(datasource) ?? []), ref]);
  }
  if (refsByDatasource.size <= 1) {
    return { ok: true, datasource: [...refsByDatasource.keys()][0] ?? null };
  }
  const breakdown = [...refsByDatasource.entries()]
    .map(([datasource, dsRefs]) => `${datasource} (${dsRefs.join(', ')})`)
    .join('; ');
  return {
    ok: false,
    message:
      'BLOCKED: mixed-datasource field references — cannot build worksheet\n\n' +
      `taskSpec.fields resolve to multiple datasources — ${breakdown}. The no-manifest passthrough ` +
      'path substitutes a single {{DATASOURCE}} and would silently repoint fields to the wrong datasource.\n\n' +
      'FIX: Provide refs from one datasource, or use a manifest-backed template/data-model relationship that binds within one datasource.',
  };
}

const paramsSchema = {
  session: z.string().optional(),
  taskSpec: z.object({
    worksheetName: z.string(),
    // worksheetFile + type are DEAD (never destructured/used at the callback — the impl reads
    // { worksheetName, workbookFile, template, fields }). They were REQUIRED in the schema, so
    // an agent that (reasonably) omitted them hit a Zod invalid_type and fell into a retry
    // spiral. Made optional so a minimal, correct taskSpec validates; kept for back-compat.
    worksheetFile: z.string().optional(),
    type: z.enum(['kpi', 'chart']).optional(),
    template: z.string().optional(),
    fields: z.array(z.string()),
    workbookFile: z.string().optional().describe('Cache path; omit to fetch current workbook.'),
  }),
};

const toolTitle = 'Build and Apply Worksheet';
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

          // SEA-aware template read (#433 seam): embedded asset in a SEA binary, disk otherwise.
          let templateXml = readTemplate(template);
          if (!templateXml) {
            return new ArgsValidationError(
              `Template not found: "${template}". Check available templates with the template list tool.`,
            ).toErr();
          }

          const sessionResult = resolveSession(session);
          if (sessionResult.isErr()) {
            return sessionResult.error.toErr();
          }
          const resolvedSession = sessionResult.value;

          const gateResult = checkRouteGateForScratchEntry(
            'build-and-apply-worksheet',
            resolvedSession,
          );
          if (gateResult) {
            return new Ok(gateResult);
          }

          let executor: ToolExecutor | undefined;
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

          const templateRequirements = getTemplateColumnRequirements(templateXml);
          const templateDimensions = templateRequirements.filter((c) => c.role === 'dimension');
          const templateMeasures = templateRequirements.filter((c) => c.role === 'measure');

          // Group resolved fields by role. Role values outside the supported pair are
          // treated as unresolved rather than silently routed to dimension.
          const dimensionFields = resolvedFields.filter(
            (resolution) => resolution.field.role === 'dimension',
          );
          const measureFields = resolvedFields.filter(
            (resolution) => resolution.field.role === 'measure',
          );
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

          // Legacy positional mapping — kept ONLY as the no-manifest passthrough.
          // Manifest-backed templates get their mapping from bindExplicitTemplate below.
          const passthroughFieldMapping: Record<string, string> = {};
          const passthroughFieldMetadata: Record<string, { datatype: string; type: string }> = {};

          for (let i = 0; i < templateDimensions.length && i < dimensionFields.length; i++) {
            const { columnRef, field } = dimensionFields[i];
            passthroughFieldMapping[templateDimensions[i].name] = columnRef;
            if (field.datatype && field.type) {
              passthroughFieldMetadata[templateDimensions[i].name] = {
                datatype: field.datatype,
                type: field.type,
              };
            }
          }

          for (let i = 0; i < templateMeasures.length && i < measureFields.length; i++) {
            const { columnRef, field } = measureFields[i];
            passthroughFieldMapping[templateMeasures[i].name] = columnRef;
            if (field.datatype && field.type) {
              passthroughFieldMetadata[templateMeasures[i].name] = {
                datatype: field.datatype,
                type: field.type,
              };
            }
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

          // Manifest enforcement (P0 W-23447710): slot derivations/keys come from the
          // manifest, never the caller's positional refs. Blockers stop the apply —
          // stricter than the old behavior, which left sample fields in unmapped slots.
          const explicitBind = bindExplicitTemplate(
            template,
            supportedResolvedFields.map((resolution) => resolution.columnRef),
            schemaSummary,
            {
              title: worksheetName,
              datasource: schemaSummary.datasource,
              passthroughFieldMapping,
            },
          );

          if (!explicitBind.ok) {
            return new ArgsValidationError(
              formatExplicitBindErrors(template, explicitBind.errors),
            ).toErr();
          }

          warnings.push(...explicitBind.warnings);

          if (explicitBind.passthrough) {
            const overflowDimensionFields = dimensionFields.slice(templateDimensions.length);
            const overflowMeasureFields = measureFields.slice(templateMeasures.length);
            for (const dropped of overflowDimensionFields) {
              droppedRequestedFields.push(dropped.requested);
              warnings.push(
                `Dimension field "${dropped.requested}" was dropped: template "${template}" exposes only ${templateDimensions.length} dimension slot(s).`,
              );
            }
            for (const dropped of overflowMeasureFields) {
              droppedRequestedFields.push(dropped.requested);
              warnings.push(
                `Measure field "${dropped.requested}" was dropped: template "${template}" exposes only ${templateMeasures.length} measure slot(s).`,
              );
            }
            const legacyDroppedResolutions = new Set([
              ...overflowDimensionFields,
              ...overflowMeasureFields,
            ]);
            appliedResolvedFields = supportedResolvedFields.filter(
              (resolution) => !legacyDroppedResolutions.has(resolution),
            );
          } else {
            const consumedFieldRefs = new Set(explicitBind.consumedFieldRefs);
            const manifestDimensionSlots = manifestRoleSlotCount(
              explicitBind.templateSlots,
              'dimension',
            );
            const manifestMeasureSlots = manifestRoleSlotCount(
              explicitBind.templateSlots,
              'measure',
            );
            // One consumed ref satisfies one request: claim each ref as it
            // matches so a duplicated requested field can't double-report as
            // applied when the binder consumed it once.
            const unclaimedConsumedRefs = new Set(consumedFieldRefs);
            appliedResolvedFields = supportedResolvedFields.filter((resolution) =>
              unclaimedConsumedRefs.delete(resolution.columnRef),
            );
            const appliedResolutionSet = new Set(appliedResolvedFields);
            for (const dropped of supportedResolvedFields) {
              // Membership in the CLAIMED applied set, not the raw consumed-ref
              // set — a duplicated request whose ref was consumed once must
              // surface as dropped, not silently vanish.
              if (appliedResolutionSet.has(dropped)) continue;
              droppedRequestedFields.push(dropped.requested);
              if (dropped.field.role === 'dimension') {
                warnings.push(
                  `Dimension field "${dropped.requested}" was dropped: template "${template}" exposes only ${manifestDimensionSlots} dimension slot(s).`,
                );
              } else {
                warnings.push(
                  `Measure field "${dropped.requested}" was dropped: template "${template}" exposes only ${manifestMeasureSlots} measure slot(s).`,
                );
              }
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
          let rewriteDatasource = explicitBind.datasource;
          if (explicitBind.passthrough) {
            const inferred = inferSingleDatasourceFromColumnRefs(bindFields);
            if (!inferred.ok) {
              return new ArgsValidationError(inferred.message).toErr();
            }
            rewriteDatasource = inferred.datasource ?? explicitBind.datasource;
          }
          const fieldMetadata =
            Object.keys(explicitBind.fieldMetadata).length > 0
              ? explicitBind.fieldMetadata
              : passthroughFieldMetadata;

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
          templateXml = rewriteFieldReferences(
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
          // Parity with the binder auto-apply path (injectTemplateCore): a waterfall
          // built through this fallback must also exclude subtotal/total rows, or the
          // running total double-counts them. No-ops unless the XML is a waterfall with
          // a bound anchor_category. Was missing here since #560 wired only the inject core.
          templateXml = spliceWaterfallAnchorFilter(templateXml, fieldMapping);

          // Extract worksheet element
          const worksheetMatch = templateXml.match(/<worksheet(?!s)[^>]*>[\s\S]*?<\/worksheet>/);
          if (!worksheetMatch) {
            return new ArgsValidationError(
              `Invalid template format: "${template}". Template must contain a <worksheet> element.`,
            ).toErr();
          }
          const worksheetXml = worksheetMatch[0];

          // Apply to Tableau
          executor ??= await extra.getExecutor(resolvedSession);
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
