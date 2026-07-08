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

import { wellFormedXmlRule } from '../validation/rules/wellFormedXml.js';
import { spliceBoundFacet } from './facetSplice.js';
import { rewriteFieldReferences } from './fieldReferenceRewriter.js';
import { injectTemplate, InsertPosition, SheetType } from './injectTemplate.js';

/** Escape the five XML metacharacters (identical to the inject-template tool). */
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
 * Substitute a template's placeholders + field references and inject it into the
 * workbook XML, returning the modified workbook (or the well-formedness issues).
 * Mirrors the inject-template tool's transformation exactly.
 */
/**
 * Remove an existing same-named worksheet (and its worksheet-class window entry) so a
 * re-inject REPLACES the sheet instead of Desktop deduplicating it to "Name (1)" (W60:
 * repeat demo asks piled up suffixed copies). Conservative: if the name is referenced by
 * any dashboard zone, the workbook is returned UNCHANGED and Desktop's dedup applies —
 * silently deleting a dashboard's member sheet would corrupt the dashboard. Pure string
 * ops on XML already in hand: no extra roundtrips.
 */
export function removeSameNamedWorksheet(workbookXml: string, title: string): string {
  const escaped = escapeXml(title);
  const nameAttr = escaped.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const worksheetRe = new RegExp(`[ \\t]*<worksheet name='${nameAttr}'>[\\s\\S]*?</worksheet>\\n?`);
  if (!worksheetRe.test(workbookXml)) {
    return workbookXml;
  }
  // Referenced by a dashboard zone? Leave it alone (fail-safe to Desktop dedup).
  const zoneRe = new RegExp(`<zone [^>]*name='${nameAttr}'`);
  if (zoneRe.test(workbookXml)) {
    return workbookXml;
  }
  let out = workbookXml.replace(worksheetRe, '');
  const windowRe = new RegExp(
    `[ \\t]*<window class='worksheet'[^>]*name='${nameAttr}'[^>]*(?:/>|>[\\s\\S]*?</window>)\\n?`,
  );
  out = out.replace(windowRe, '');
  return out;
}

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
