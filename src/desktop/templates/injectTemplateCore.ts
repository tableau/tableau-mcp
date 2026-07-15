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

import { normalizeArray, parseXML, serializeXML } from '../metadata/parser.js';
import { ParsedWindow, ParsedWorkbook, ParsedWorksheet } from '../metadata/types.js';
import { wellFormedXmlRule } from '../validation/rules/wellFormedXml.js';
import { spliceBoundFacet } from './facetSplice.js';
import { rewriteFieldReferences } from './fieldReferenceRewriter.js';
import { injectTemplate, InsertPosition, SheetType } from './injectTemplate.js';

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
  insertPosition?: InsertPosition;
  relativeSheetName?: string;
  /**
   * Deterministic per-apply nonce for calc namespacing. The pure rewriter never
   * mints its own nonce, so every caller supplies one derived from its own
   * per-apply identity (workbook file + timestamp, or session + timestamp).
   */
  applyNonce: string;
}

/**
 * Result of building the injected workbook XML. `ok:false` carries the
 * well-formedness issues so the caller decides how to surface them (the
 * inject-template tool → XmlValidationError; bind-template → graceful fallback).
 * Structural failures inside injectTemplate THROW and propagate to the caller.
 */
export type InjectTemplateCoreResult = { ok: true; xml: string } | { ok: false; issues: string[] };

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
    zones.some(
      (zone) =>
        !!zone && typeof zone === 'object' && (zone as Record<string, unknown>)['@_name'] === title,
    )
  ) {
    return true;
  }
  return Object.values(record).some((value) => hasZoneNamed(value, title));
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
  const kept = worksheets.filter((ws) => ws?.['@_name'] !== title);
  if (!wb || !container || kept.length === worksheets.length) {
    return workbookXml;
  }
  if (hasZoneNamed(workbook, title)) {
    return workbookXml;
  }
  container.worksheet = kept.length === 1 ? kept[0] : kept;
  const windows = normalizeArray<ParsedWindow>(wb.windows?.window);
  const keptWindows = windows.filter(
    (w) => !(w?.['@_class'] === 'worksheet' && w?.['@_name'] === title),
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
  insertPosition,
  relativeSheetName,
  applyNonce,
}: InjectTemplateCoreParams): InjectTemplateCoreResult {
  // W60 demo-idempotence: a worksheet inject with a colliding title replaces the
  // existing sheet rather than accumulating "Name (1)" copies.
  const baseWorkbookXml =
    sheetType === 'worksheet' ? removeSameNamedWorksheet(workbookXml, title) : workbookXml;

  let processed = templateXml.replace(/\{\{TITLE\}\}/g, escapeXml(title));

  if (templateParameters) {
    for (const [key, value] of Object.entries(templateParameters)) {
      if (key === 'DATASOURCE') continue;
      processed = processed.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), escapeXml(value));
    }
  }

  if (templateParameters?.['DATASOURCE']) {
    // W28-C: splice a BOUND facet pill onto the trellis shelf BEFORE the frozen
    // core rewrite (identity no-op when no facet is bound). The core then maps
    // [Facet] → the bound field.
    processed = ensureUserNamespace(processed);
    processed = spliceBoundFacet(processed, fieldMapping ?? {});
    processed = rewriteFieldReferences(
      processed,
      fieldMapping ?? {},
      templateParameters['DATASOURCE'],
      undefined,
      { namespaceCalcs: true, applyNonce },
    );
  }

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

  return { ok: true, xml: modifiedXml };
}
