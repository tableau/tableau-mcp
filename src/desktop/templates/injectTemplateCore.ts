// Shared inject core — the template→workbook transformation extracted from the
// inject-template tool (src/tools/desktop/template/injectTemplate.ts) so the
// bind-template auto-apply path (W60) can run the SAME proven inject without
// duplicating it. This is intentionally PURE over strings: no fs (the caller
// reads the template + workbook), no MCP, no logging. It reproduces the tool's
// exact substitution order and escaping so both callers behave identically.
//
// ESCAPING CONTRACT (unchanged from the tool): {{TITLE}} and every non-DATASOURCE
// {{PLACEHOLDER}} value are XML-escaped HERE before substitution; DATASOURCE and
// the field_mapping values are handed RAW to rewriteFieldReferences, which escapes
// them EXACTLY ONCE via DOM serialization. Callers pass values verbatim — the
// inject-template tool passes agent-supplied raw strings; bind-template passes the
// binder's args as-is (matching what the manual inject-template call would receive).

import { DOMParser, XMLSerializer } from '@xmldom/xmldom';

import { listAvailableFields } from '../metadata/field-builder.js';
import { normalizeArray, parseXML, serializeXML } from '../metadata/parser.js';
import { ParsedWindow, ParsedWorkbook, ParsedWorksheet } from '../metadata/types.js';
import { unsubstitutedTemplateTokenRule } from '../validation/rules/unsubstitutedTemplateToken.js';
import { wellFormedXmlRule } from '../validation/rules/wellFormedXml.js';
import { xmlNamesEqual } from '../xmlElement.js';
import { type DateparseAxisSpec, spliceDateparseTemporalAxis } from './dateparseTemporalAxis.js';
import { spliceBoundFacet } from './facetSplice.js';
import {
  type FieldMetadataOverride,
  rewriteFieldReferencesWithDiagnostics,
  type TemplateSlotReference,
} from './fieldReferenceRewriter.js';
import {
  spliceBoundCalcDefinitions,
  spliceBoundGroupDefinitions,
} from './groupDefinitionSplice.js';
import { injectTemplate, InsertPosition, SheetType } from './injectTemplate.js';
import { type OptionalFieldPruneSpec, pruneUnboundOptionalFields } from './optionalFieldPrune.js';
import { spliceWaterfallAnchorFilter } from './waterfallAnchorFilter.js';

const AUTHORED_TITLE_SENTINEL = '__TABLEAU_MCP_AUTHORED_TITLE_4D9E7A1B__';
const DONOR_CURRENCY_OR_LOCALE_FORMAT = /[$£€¥₹₩₽₺₫₪₴₦₱฿₡₲₵₭₮₸₼₾₿]|\[\$-[^\]]+\]|^c(?=["#0*])/u;

/** Remove donor locale overrides only on the automatic field-binding path. */
export function stripDonorCurrencyOrLocaleFormats(
  templateXml: string,
  fieldMapping: Record<string, string> | undefined,
): string {
  if (!fieldMapping || Object.keys(fieldMapping).length === 0) return templateXml;
  const rewritesAuthoredField = Object.keys(fieldMapping).some((mappingKey) => {
    const field = mappingKey.replace(/@[A-Za-z][A-Za-z0-9-]*$/, '');
    const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`\\[${escaped}\\]|:${escaped}:`).test(templateXml);
  });
  if (!rewritesAuthoredField) return templateXml;
  const document = new DOMParser().parseFromString(templateXml, 'text/xml');
  for (const format of Array.from(
    document.getElementsByTagName('format'),
  ) as unknown as Element[]) {
    const value = format.getAttribute('value');
    if (
      format.getAttribute('attr') === 'text-format' &&
      value &&
      DONOR_CURRENCY_OR_LOCALE_FORMAT.test(value)
    ) {
      // Dropping the donor override lets the target field win; Desktop supplies a neutral default otherwise.
      format.parentNode?.removeChild(format);
    }
  }
  return new XMLSerializer().serializeToString(document);
}

/** Escape the five XML metacharacters (identical to the inject-template tool). */
/**
 * xmldom >=0.9 (this repo ships 0.9.10) throws NamespaceError serializing user:*
 * attributes with no xmlns:user in scope; templates are workbook fragments that
 * historically omitted the declaration. No-op when declared or unused.
 * Ported from a2td 3ee7bb6.
 */
export function ensureUserNamespace(xml: string): string {
  if (!/\buser:[A-Za-z0-9_-]+/.test(xml)) return xml;
  if (/\sxmlns:user=/.test(xml)) return xml;
  return xml.replace(
    /<([A-Za-z0-9:_-]+)(\s|>)/,
    "<$1 xmlns:user='http://www.tableausoftware.com/xml/user'$2",
  );
}

export function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Bare local field name out of a field_mapping VALUE. Values are
 * `[datasource].[deriv:Field Name:suffix]` (or the unqualified `[deriv:Field:suffix]`),
 * pre-escaped for XML attributes — so unescape before matching a schema name that
 * carries an apostrophe or ampersand.
 */
function mappedFieldName(columnInstance: string): string | null {
  const stripped = columnInstance.includes('].[')
    ? columnInstance.substring(columnInstance.indexOf('].[') + 2)
    : columnInstance;
  const match = stripped.match(/\[([^:]+):(.+):([^:\]]+)\]$/);
  if (!match) return null;
  return match[2]
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/**
 * Fill in each bound field's TRUE `semantic-role` from the TARGET workbook, which is
 * the only authority on what its own datasources geocode.
 *
 * Without this, `rewriteFieldReferences` renames a template's geo `<column>` but has
 * nothing to reconcile its `semantic-role` against, so the donor's geography rides
 * along onto whatever field was bound — a `[City].[Name]` asserted on a field the
 * target never geocodes yields a map with zero marks (its rows/cols are the GENERATED
 * Lat/Long that only materialize for a genuinely geocoded field).
 *
 * Reading the workbook here rather than making each caller thread metadata through
 * means the inject-template tool and the dashboard path are covered too, not just the
 * binder. A caller-supplied entry always wins — it came from the binder's own resolved
 * schema. Fields absent from the workbook schema are left alone: an entry is added
 * only to carry a role that genuinely exists.
 */
function withTargetSemanticRoles(
  supplied: Record<string, FieldMetadataOverride> | undefined,
  fieldMapping: Record<string, string> | undefined,
  workbookXml: string,
): Record<string, FieldMetadataOverride> | undefined {
  if (!fieldMapping || Object.keys(fieldMapping).length === 0) return supplied;

  const needed = new Map<string, string>(); // mapping key -> bare field name
  for (const [key, value] of Object.entries(fieldMapping)) {
    if (supplied?.[key]?.semanticRole) continue;
    const name = mappedFieldName(value);
    if (name) needed.set(key, name);
  }
  if (needed.size === 0) return supplied;

  let roleByField: Map<string, string>;
  try {
    roleByField = semanticRolesByFieldName(workbookXml);
  } catch {
    // A workbook we cannot parse tells us nothing about geocoding. Returning the
    // supplied metadata unchanged makes the rewriter DROP donor roles, which is the
    // safe direction: a missing role renders a plain (non-geocoded) mark, while a
    // fabricated one renders an empty map.
    return supplied;
  }
  if (roleByField.size === 0) return supplied;

  const merged: Record<string, FieldMetadataOverride> = { ...(supplied ?? {}) };
  for (const [key, fieldName] of needed) {
    const role = roleByField.get(fieldName);
    if (!role) continue;
    const existing = merged[key];
    merged[key] = existing
      ? { ...existing, semanticRole: role }
      : // datatype/type are only written onto attributes the template already
        // carries, and the rewriter re-reads them from the DOM when absent here;
        // echoing the template's own values would be a guess, so leave them empty.
        { datatype: '', type: '', semanticRole: role };
  }
  return merged;
}

/**
 * Every `semantic-role` the workbook declares, keyed by bare field name. Built from
 * the same `listAvailableFields` projection the binder's schema summary uses, so the
 * two agree on which fields are geocodable.
 */
function semanticRolesByFieldName(workbookXml: string): Map<string, string> {
  const roles = new Map<string, string>();
  for (const f of listAvailableFields(workbookXml)) {
    if (!f.semanticRole) continue;
    const bare = f.columnName.replace(/^\[|\]$/g, '');
    roles.set(bare, f.semanticRole);
    if (f.caption) roles.set(f.caption, f.semanticRole);
  }
  return roles;
}

export interface InjectTemplateCoreParams {
  /** In-memory workbook XML the template is injected into. */
  workbookXml: string;
  /** Raw template file content (already read by the caller). */
  templateXml: string;
  /** Sheet title; substituted for {{TITLE}} (escaped here). */
  title: string;
  sheetType: SheetType;
  /** {{PLACEHOLDER}} substitutions; DATASOURCE is delegated to the field rewriter. */
  templateParameters?: Record<string, string>;
  /** Template field name → column-instance ref map (RAW; escaped once downstream). */
  fieldMapping?: Record<string, string>;
  /** Manifest-declared bindable slots used to remove/guard literal template fields. */
  templateSlots?: readonly TemplateSlotReference[];
  /**
   * Per-bound-field datatype/type/semanticRole, keyed exactly like `fieldMapping`.
   * Load-bearing for geo slots: without the bound field's own `semanticRole` the
   * rewriter cannot tell "this field is geocodable as a city" from "the DONOR was",
   * and a renamed column would keep asserting the donor's geography. Omit for a
   * caller with no schema (the rewriter then drops donor roles rather than keeping
   * a geography the target datasource never declared).
   */
  fieldMetadata?: Record<string, FieldMetadataOverride>;
  insertPosition?: InsertPosition;
  relativeSheetName?: string;
  /**
   * Deterministic per-apply nonce for calc namespacing. The pure rewriter never
   * mints its own nonce, so every caller supplies one derived from its own
   * per-apply identity (workbook file + timestamp, or session + timestamp).
   */
  applyNonce: string;
  /** Optional runtime-approved field refs to remove before normal field rewriting. */
  optionalFieldPrunes?: OptionalFieldPruneSpec[];
  /**
   * temporal_axis_from_string: when the binder bound a date-like STRING to a temporal
   * slot, this spec turns the template's temporal base column into a DATEPARSE calc
   * (see dateparseTemporalAxis.ts). Undefined for every normal apply → no-op.
   */
  dateparseAxis?: DateparseAxisSpec;
  /** Validated histogram-only bin width; undefined preserves the authored template byte. */
  histogramBinSize?: number;
}

function spliceHistogramBinSize(templateXml: string, binSize: number | undefined): string {
  if (binSize === undefined) return templateXml;
  const binCalculation = /<calculation\b(?=[^>]*\bclass=(['"])bin\1)[^>]*>/g;
  const matches = [...templateXml.matchAll(binCalculation)];
  if (matches.length !== 1) {
    throw new Error(
      `Histogram bin_size requires exactly one authored bin calculation; found ${matches.length}`,
    );
  }
  return templateXml.replace(binCalculation, (tag) =>
    /\bsize=(['"])[^'"]*\1/.test(tag)
      ? tag.replace(/\bsize=(['"])[^'"]*\1/, `size='${binSize}'`)
      : tag.replace(/\s*\/>$|>$/, (end) => ` size='${binSize}'${end}`),
  );
}

/**
 * Result of building the injected workbook XML. `ok:false` carries the
 * well-formedness issues so the caller decides how to surface them (the
 * inject-template tool → XmlValidationError; bind-template → graceful fallback).
 * Structural failures inside injectTemplate THROW and propagate to the caller.
 */
export type InjectTemplateCoreResult =
  | { ok: true; xml: string; warnings?: string[] }
  | { ok: false; issues: string[] };

/**
 * True when any `<zone>` element ANYWHERE in the parsed workbook carries the sheet
 * name — the member-sheet protection oracle for removeSameNamedWorksheet. Walks the
 * whole tree (dashboards, nested layout zones, story points) exactly like the old
 * whole-string regex did, but on decoded attribute values.
 */
function hasZoneNamed(node: unknown, title: string): boolean {
  if (!node || typeof node !== 'object') return false;
  if (Array.isArray(node)) return node.some((entry) => hasZoneNamed(entry, title));
  const record = node as Record<string, unknown>;
  const zones = normalizeArray(record['zone']);
  if (
    zones.some((zone) => {
      if (!zone || typeof zone !== 'object') return false;
      const zoneName = (zone as Record<string, unknown>)['@_name'];
      return typeof zoneName === 'string' && xmlNamesEqual(zoneName, title);
    })
  ) {
    return true;
  }
  return Object.values(record).some((value) => hasZoneNamed(value, title));
}

/**
 * Classify a worksheet name as an in-place replace target. 'replaceable' means
 * removeSameNamedWorksheet will actually swap it (its fail-safes won't defer):
 * 'in-dashboard' would silently corrupt the dashboard, so callers must refuse
 * rather than let Desktop dedup the inject into a stray "Name (1)" copy.
 * Unparseable XML reports 'not-found' — downstream parses surface the real error.
 */
export function classifyWorksheetReplaceTarget(
  workbookXml: string,
  name: string,
): 'replaceable' | 'in-dashboard' | 'not-found' {
  let workbook: ParsedWorkbook;
  try {
    workbook = parseXML(workbookXml);
  } catch {
    return 'not-found';
  }
  const worksheets = normalizeArray<ParsedWorksheet>(workbook.workbook?.worksheets?.worksheet);
  if (!worksheets.some((ws) => ws?.['@_name'] && xmlNamesEqual(ws['@_name'], name))) {
    return 'not-found';
  }
  return hasZoneNamed(workbook, name) ? 'in-dashboard' : 'replaceable';
}

/** Whether any worksheet, dashboard, or story already owns a global sheet name. */
export function workbookHasSheetNamed(workbookXml: string, name: string): boolean {
  let workbook: ParsedWorkbook;
  try {
    workbook = parseXML(workbookXml);
  } catch {
    return false;
  }
  const root = workbook.workbook as Record<string, unknown> | undefined;
  return (
    [
      ['worksheets', 'worksheet'],
      ['dashboards', 'dashboard'],
      ['stories', 'story'],
    ] as const
  ).some(([containerName, sheetName]) => {
    const container = root?.[containerName];
    if (!container || typeof container !== 'object') return false;
    const sheets = (container as Record<string, unknown>)[sheetName] as
      | Record<string, unknown>
      | Record<string, unknown>[]
      | undefined;
    return normalizeArray<Record<string, unknown>>(sheets).some((sheet) => {
      const sheetName = sheet['@_name'];
      return typeof sheetName === 'string' && xmlNamesEqual(sheetName, name);
    });
  });
}

/**
 * Remove every existing same-named worksheet (and worksheet-class window entry) so a
 * re-inject REPLACES the sheet instead of Desktop deduplicating it to "Name (1)" (W60:
 * repeat demo asks piled up suffixed copies). STRUCTURAL (parse → filter → serialize
 * with the pipeline's own parser.ts pair), not string surgery: quote style, attribute
 * order, whitespace, and entity encoding cannot defeat the match (the regex layer this
 * replaces was defeated twice — adversary P0-3 quote flip, P2-7 attribute order).
 * ALL same-named nodes are removed, not just the first (P2-8): Desktop enforces unique
 * sheet names, so same-named siblings are always stale pile-up copies of one sheet —
 * never distinct user work — and one apply now converges them.
 * Fail-safes (both return the input string byte-identical, deferring to Desktop dedup):
 * - the name is referenced by any dashboard zone — silently deleting a dashboard's
 *   member sheet would corrupt the dashboard;
 * - the XML does not parse — never strip what we cannot prove safe (the downstream
 *   injectTemplate parse surfaces the real error).
 */
export function removeSameNamedWorksheet(workbookXml: string, title: string): string {
  let workbook: ParsedWorkbook;
  try {
    workbook = parseXML(workbookXml);
  } catch {
    return workbookXml;
  }
  const wb = workbook.workbook;
  const container = wb?.worksheets;
  const worksheets = normalizeArray<ParsedWorksheet>(container?.worksheet);
  const kept = worksheets.filter((ws) => !ws?.['@_name'] || !xmlNamesEqual(ws['@_name'], title));
  if (!wb || !container || kept.length === worksheets.length) {
    return workbookXml;
  }
  if (hasZoneNamed(workbook, title)) {
    return workbookXml;
  }
  if (kept.length === 0) {
    delete container.worksheet;
  } else {
    container.worksheet = kept.length === 1 ? kept[0] : kept;
  }
  const windows = normalizeArray<ParsedWindow>(wb.windows?.window);
  const keptWindows = windows.filter(
    (w) => !(w?.['@_class'] === 'worksheet' && w?.['@_name'] && xmlNamesEqual(w['@_name'], title)),
  );
  if (wb.windows && keptWindows.length !== windows.length) {
    wb.windows.window = keptWindows.length === 1 ? keptWindows[0] : keptWindows;
  }
  return serializeXML(workbook);
}

/**
 * Substitute a template's placeholders + field references and inject it into the
 * workbook XML, returning the modified workbook (or the well-formedness issues).
 * Mirrors the inject-template tool's transformation exactly.
 */
export function buildInjectedWorkbookXml({
  workbookXml,
  templateXml,
  title,
  sheetType,
  templateParameters,
  fieldMapping,
  templateSlots,
  fieldMetadata,
  insertPosition,
  relativeSheetName,
  applyNonce,
  optionalFieldPrunes,
  dateparseAxis,
  histogramBinSize,
}: InjectTemplateCoreParams): InjectTemplateCoreResult {
  // W60 demo-idempotence: a worksheet inject with a colliding title replaces the
  // existing sheet rather than accumulating "Name (1)" copies.
  const baseWorkbookXml =
    sheetType === 'worksheet' ? removeSameNamedWorksheet(workbookXml, title) : workbookXml;

  let processed = spliceHistogramBinSize(templateXml, histogramBinSize).replace(
    /\{\{TITLE\}\}/g,
    AUTHORED_TITLE_SENTINEL,
  );
  const rewriteWarnings: string[] = [];

  if (
    !templateParameters?.['DATASOURCE'] &&
    templateSlots?.some((slot) => slot.bindable !== false && slot.required)
  ) {
    throw new Error(
      'Template binding is incomplete: provide a datasource and choose every required chart field, then retry. No worksheet was produced.',
    );
  }

  if (templateParameters?.['DATASOURCE']) {
    processed = pruneUnboundOptionalFields(processed, optionalFieldPrunes);
    // W28-C: splice a BOUND facet pill onto the trellis shelf BEFORE the frozen
    // core rewrite (identity no-op when no facet is bound). The core then maps
    // [Facet] → the bound field.
    processed = ensureUserNamespace(processed);
    // temporal_axis_from_string: convert the temporal base column into a DATEPARSE calc
    // BEFORE the core rewrite (identity no-op when no dateparse axis). The binder skipped
    // this slot's field_mapping key, so the rewrite leaves the (now-calc) column and its
    // Month-Trunc CI alone — the axis truncates a parsed date instead of a raw string.
    processed = spliceDateparseTemporalAxis(processed, dateparseAxis ?? null);
    processed = spliceBoundFacet(processed, fieldMapping ?? {}, templateSlots);
    processed = stripDonorCurrencyOrLocaleFormats(processed, fieldMapping);
    const rewrite = rewriteFieldReferencesWithDiagnostics(
      processed,
      fieldMapping ?? {},
      templateParameters['DATASOURCE'],
      withTargetSemanticRoles(fieldMetadata, fieldMapping, workbookXml),
      { namespaceCalcs: true, applyNonce, templateSlots },
    );
    processed = rewrite.xml;
    rewriteWarnings.push(...rewrite.droppedOptionalElements);
    processed = spliceBoundGroupDefinitions(processed, fieldMapping, workbookXml);
    processed = spliceBoundCalcDefinitions(processed, fieldMapping, workbookXml);
    processed = spliceWaterfallAnchorFilter(processed, fieldMapping ?? {});
  }

  // Strip donor formats before caller-authored format parameters are substituted.
  // Otherwise a legitimate currency VALUE_FORMAT looks like donor metadata and is
  // removed from the generated worksheet.
  if (templateParameters) {
    for (const [key, value] of Object.entries(templateParameters)) {
      // Field placeholders are resolved only through runtime slot-backed
      // field_mapping. Generic parameter replacement would bypass derivation,
      // metadata, optional-prune, and survivor guards.
      if (key === 'DATASOURCE' || /^field_base_[1-9]\d*$/.test(key)) continue;
      processed = processed.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), () => escapeXml(value));
    }
  }

  const templateTokenIssues = unsubstitutedTemplateTokenRule.validate(processed);
  if (templateTokenIssues.length > 0) {
    return { ok: false, issues: templateTokenIssues.map((issue) => issue.message) };
  }

  processed = processed.replace(new RegExp(AUTHORED_TITLE_SENTINEL, 'g'), escapeXml(title));

  const modifiedXml = injectTemplate(
    baseWorkbookXml,
    processed,
    sheetType,
    insertPosition ?? 'end',
    relativeSheetName,
  );

  const issues = wellFormedXmlRule.validate(modifiedXml);
  if (issues.length > 0) {
    return { ok: false, issues: issues.map((i) => i.message) };
  }

  return {
    ok: true,
    xml: modifiedXml,
    ...(rewriteWarnings.length > 0 ? { warnings: rewriteWarnings } : {}),
  };
}
