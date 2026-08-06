// Bookmark (.tbm) reader + in-memory tokenizer.
//
// A Tableau Desktop bookmark is the CANONICAL stored template format: a `<bookmark>`
// root carrying the donor `<datasources>` schema (the exact
// `<column datatype role type semantic-role>` attributes summarizeSchema reads), a
// `<table>` of shelf encodings, and — critically — a `<cards>` block that the
// hand-authored `.xml` templates all omit and nothing in src/ synthesizes.
//
// This module does two things and NOTHING chart-specific: it normalizes the raw
// bytes (legacy-format repairs), and it converts a bookmark into the
// `<workbook><worksheets><worksheet>` shape the existing inject core already
// consumes — parameterizing the donor datasource to `{{DATASOURCE}}` and tokenizing
// each placed donor field to `{{field_base_N}}`. Slot inference (which fields, what
// kind, generic purpose) lives in inferSlots.ts; the two share the types defined here.
//
// Ported from the #716 TBM compiler authority. Tests below this module pin the
// normalization, tokenization, donor-removal, and eligibility contracts.

import { createHash } from 'node:crypto';

import { DOMParser } from '@xmldom/xmldom';

import type {
  CommunicativeRole,
  Derivation,
  SlotKind,
  TableCalcFact,
} from '../binder/manifest-types.js';
import { canonicalShortDerivation, COLUMN_INSTANCE_WRAPPER_PREFIXES } from '../derivations.js';
import { runValidation } from '../validation/registry.js';
import { ensureUserNamespace } from './injectTemplateCore.js';

/**
 * Where a donor field reference appears in the sheet. `rows`/`cols`/`mark` are the axis/mark
 * shelves (refs in element TEXT content). The rest are MARK-ENCODING shelves — children of
 * `<encodings>` whose ref lives in a `column=` attribute; the child's TAG NAME is the shelf.
 * An encoding-only chart (treemap, pie, symbol map) places every field here and nothing on
 * rows/cols, so a walk restricted to rows/cols/mark inferred ZERO slots for it. The tag name
 * is read structurally — identical code for every chart, never keyed on chart family.
 *
 * The last three are REFINEMENT sites, not axis/mark shelves: `filter` (a filter/slices pill
 * scoping the data), `title` (a field-reference run surfaced in the sheet title text), and
 * `reference-line` (a measure positioning an analytical line). A field can appear ONLY at one
 * of these and nowhere else; without walking them such a field is dropped from inference
 * entirely. They are read structurally by site, still never keyed on chart family.
 */
export type Shelf =
  | 'rows'
  | 'cols'
  | 'mark'
  | 'color'
  | 'size'
  | 'text'
  | 'label'
  | 'detail'
  | 'lod'
  | 'tooltip'
  | 'shape'
  | 'path'
  | 'geometry'
  | 'angle'
  | 'wedge-size'
  | 'filter'
  | 'title'
  | 'reference-line';

/** One `<column>` dictionary entry from the bookmark's donor datasource(s). */
export interface ColumnDef {
  name: string;
  caption: string;
  datatype: string;
  role: string;
  type: string;
  semanticRole: string;
  isCalc: boolean;
  isParameter: boolean;
  formula: string;
  /** Immediate formula dependencies; calc-to-calc edges are resolved by inferSlots. */
  baseInputs: string[];
}

export type ColumnInstanceRole = 'nk' | 'ok' | 'qk';

/**
 * One inferred, bindable slot. `sourceField` is the donor base name (used only to
 * TOKENIZE it away — it never surfaces to an agent); `kind`/`derivation`/`shelves`/
 * `required`/`purpose` are the generic, dataset-independent facts derived from the
 * sheet's own encodings.
 */
export interface InferredSlot {
  slot_id: string;
  sourceField: string;
  /**
   * The `{{field_base_N}}` token this slot's base field tokenizes to. Assigned per
   * DISTINCT base field (not per slot), so a base placed at several date parts
   * (YEAR + MONTH of one date) — which is several slots — shares ONE token. The
   * runtime slot descriptor and tokenized XML both read this field, so they agree by construction.
   */
  templateField: string;
  caption: string;
  shelves: Shelf[];
  kind: SlotKind;
  /** Tableau geographic semantic role, when structurally authored on the donor column. */
  semanticRole?: string;
  derivation: Derivation;
  /** Authored Tableau column-instance role marker; independent of the donor field's type. */
  instanceRole?: ColumnInstanceRole;
  required: boolean;
  /** What the slot COMMUNICATES — a single semantic descriptor derived from kind + derivation + placement. */
  role: CommunicativeRole;
  purpose: string;
  tier: 'primary' | 'advanced';
  /** TABLE-CALC semantics when this measure carries a quick/custom table calc; absent otherwise. */
  tableCalc?: TableCalcFact;
}

/**
 * A placed calculated field decomposed to the bindable base-input leaves it references at
 * ROW LEVEL. Emitted per DISTINCT calc base (shelves unioned across placements). `dependsOnSlots`
 * are already resolved to the leaf slot_ids in {@link Inference.slots}, so the synthesized
 * runtime descriptor's calc contract lines up with its slot ids by construction. This lets the
 * binder's calc-dependency and aggregation-level gates run without a sidecar manifest.
 */
export interface InferredCalc {
  /** Stable id for the calc itself — NOT a bindable slot (lives only in the runtime calc descriptor). */
  slotId: string;
  /** The calc column's identity (its bare name); calcs are not tokenized to {{field_base_N}}. */
  templateField: string;
  caption: string;
  formula: string;
  /** Base-input leaf names the formula references at row level (nested Calculation_* skipped). */
  formulaRefs: string[];
  /** The bindable leaf slot_ids (in `slots`) those refs resolve to — the Gate 4b/6 join key. */
  dependsOnSlots: string[];
  shelves: Shelf[];
}

export interface Inference {
  slots: InferredSlot[];
  /** Placed calcs, decomposed to their base-input leaf slots. Empty when the bookmark places none. */
  calcs: InferredCalc[];
  unknownCount: number;
  /** Donor field captions — retained ONLY to mechanically assert none leak into a purpose. */
  donorCaptions: string[];
  donorDatasources: string[];
  /** INTERNAL `name` attrs (federated.xxx / "Sample - Superstore"), not captions. */
  donorDatasourceNames: string[];
  /** `<bookmark version>` — legacy eras are the entire zero-slot population. */
  version: string;
  /** Legacy pre-column-instance bookmarks declare NO `<column>` dictionary at all. */
  hasColumnDict: boolean;
}

export interface TemplatePass1Eligibility {
  pass1_eligible: boolean;
  pass1_blockers: string[];
}

function sanitizeValidationRuleId(ruleId: string): string {
  const sanitized = ruleId
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return sanitized || 'unknown-rule';
}

function isBindingResolvedPlaceholderError(ruleId: string, message: string): boolean {
  return (
    ruleId === 'unsubstituted-template-token' &&
    /\{\{(?:DATASOURCE|field_base_[1-9]\d*)\}\}/.test(message)
  );
}

const PASS1_ELIGIBILITY_VALIDATION_CACHE_MAX_ENTRIES = 256;

export function createPass1EligibilityValidationMemo(
  compute: (normalizedXml: string) => readonly string[],
): (normalizedXml: string) => readonly string[] {
  const entries = new Map<string, readonly string[]>();

  return (normalizedXml) => {
    const key = createHash('sha256').update(normalizedXml).digest('hex');
    const cached = entries.get(key);
    if (cached !== undefined) {
      entries.delete(key);
      entries.set(key, cached);
      return cached;
    }

    const computed = [...compute(normalizedXml)];
    entries.set(key, computed);
    if (entries.size > PASS1_ELIGIBILITY_VALIDATION_CACHE_MAX_ENTRIES) {
      const leastRecentlyUsed = entries.keys().next().value;
      if (leastRecentlyUsed !== undefined) entries.delete(leastRecentlyUsed);
    }
    return computed;
  };
}

const getPass1EligibilityValidationRuleIds = createPass1EligibilityValidationMemo((validationXml) =>
  [
    ...new Set(
      runValidation(validationXml, 'workbook')
        .issues.filter(
          (issue) =>
            issue.severity === 'error' &&
            !isBindingResolvedPlaceholderError(issue.ruleId, issue.message),
        )
        .map((issue) => sanitizeValidationRuleId(issue.ruleId)),
    ),
  ].sort((a, b) => a.localeCompare(b)),
);

/** Pass 1 excludes bookmark conversions that cannot become valid through normal binding. */
export function deriveTemplatePass1Eligibility(
  converted: Pick<ReturnType<typeof bookmarkToTemplateWorkbook>, 'bareRefs' | 'xml'>,
): TemplatePass1Eligibility {
  const bareRefs = [...new Set(converted.bareRefs)].sort((a, b) => a.localeCompare(b));
  const blockers: string[] = [];
  if (bareRefs.length > 0) {
    blockers.push(`unresolved-table-calc-bareRefs: ${bareRefs.join(', ')}`);
  }

  const validationXml = ensureUserNamespace(
    converted.xml.replace(/\{\{TITLE\}\}/g, 'Pass 1 Eligibility Probe'),
  );
  const validationRuleIds = getPass1EligibilityValidationRuleIds(validationXml);
  if (validationRuleIds.length > 0) {
    blockers.push(`pre-bind-validation-errors: ${validationRuleIds.join(', ')}`);
  }

  return {
    pass1_eligible: blockers.length === 0,
    pass1_blockers: blockers,
  };
}

/**
 * Split a column-instance ref into base name AND binding derivation. SlotSpec.derivation is
 * required and load-bearing — the binder keys qualified slots on
 * `template_field@derivation` (explicit-bind.ts:291) — so both halves must come out of one
 * parse. `[federated.x].[sum:Sales:qk]` → { base: 'Sales', derivation: 'sum' }; a bare
 * `[Region]` → { base: 'Region', derivation: 'none' }.
 *
 * A COMPOUND (table-calc) name prepends wrapper prefixes to the aggregation
 * (`[pcdf:cum:sum:Sales:qk]`); those wrappers are consumed and the BINDING derivation is the
 * underlying aggregation (`sum`), so the measure resolves normally and is not dropped. Leading
 * segments are consumed only while they are known derivation/table-calc short-forms AND at
 * least one segment remains for the base — so a field literally named like a derivation
 * (`[none:sum:qk]` → base `sum`) or containing a colon (`[sum:A:B:qk]` → base `A:B`) is
 * preserved, and an unknown single prefix still occupies the derivation slot
 * (`[foo:Bar:qk]` → { base: 'Bar', derivation: 'none' }).
 */
export function parseInstanceRef(ref: string): { base: string; derivation: Derivation } {
  const seg = ref.split('].[').pop() ?? ref;
  const inner = seg.replace(/^\[|\]$/g, '');
  const parts = inner.split(':');
  if (parts.length < 3) return { base: inner, derivation: 'none' };
  let roleIndex = -1;
  for (let index = parts.length - 1; index >= 1; index--) {
    if (parts[index] === 'nk' || parts[index] === 'ok' || parts[index] === 'qk') {
      roleIndex = index;
      break;
    }
  }
  if (roleIndex < 2) return { base: inner, derivation: 'none' };
  // Consume leading known derivation / table-calc wrapper segments, never taking the
  // second-to-last segment (the base must keep at least one segment before the role marker).
  const consumed: string[] = [];
  let i = 0;
  while (
    i < roleIndex - 1 &&
    (canonicalShortDerivation(parts[i]) !== undefined ||
      COLUMN_INSTANCE_WRAPPER_PREFIXES.has(parts[i].toLowerCase()))
  ) {
    consumed.push(parts[i].toLowerCase());
    i++;
  }
  if (consumed.length > 0) {
    // Binding derivation = the last consumed segment that is a real aggregation/date-part
    // derivation (a table-calc wrapper like `cum`/`pcdf` is not one), else `none`.
    const derivation =
      [...consumed]
        .reverse()
        .map((prefix) => canonicalShortDerivation(prefix))
        .find((candidate) => candidate !== undefined) ?? 'none';
    return { base: parts.slice(i, roleIndex).join(':'), derivation };
  }
  // No known leading prefix: parts[0] still occupies the (untrusted) derivation slot.
  const d = parts[0].toLowerCase();
  return {
    base: parts.slice(1, roleIndex).join(':'),
    derivation: canonicalShortDerivation(d) ?? 'none',
  };
}

/** The role marker authored on a Tableau column-instance reference, when present. */
export function parseInstanceRole(ref: string): ColumnInstanceRole | undefined {
  const seg = ref.split('].[').pop() ?? ref;
  const parts = seg.replace(/^\[|\]$/g, '').split(':');
  for (let index = parts.length - 1; index >= 1; index--) {
    const part = parts[index];
    if (part === 'nk' || part === 'ok' || part === 'qk') return part;
  }
  return undefined;
}

/**
 * Repair two format defects that make older Desktop-authored bookmarks unparseable:
 *   1. Leading whitespace/CRLF BEFORE the `<?xml ?>` declaration — a strict parser
 *      rejects a declaration that isn't at byte 0.
 *   2. A `user:` attribute prefix with NO `xmlns:user` declared on `<bookmark>`
 *      ("NamespaceError: prefix is non-null and namespace is null"). Newer bookmarks
 *      declare it; pre-8.0 ones use the prefix bare.
 * These are real files a customer could drop in, so the shipped reader must repair them.
 */
export function normalizeBookmarkXml(raw: string): string {
  let xml = raw.replace(/^\s+(?=<\?xml)/, '');
  if (/\buser:/.test(xml) && !/xmlns:user=/.test(xml)) {
    xml = xml.replace(
      /<bookmark\b([^>]*)>/,
      "<bookmark$1 xmlns:user='http://www.tableausoftware.com/xml/user'>",
    );
  }
  return xml;
}

/**
 * IN-MEMORY tokenization + bookmark→template-workbook conversion.
 *
 * Two things happen here, and they must come from ONE pass so the runtime descriptor's
 * `template_field` and the XML's token agree exactly:
 *   • every placed donor base name → {{field_base_N}} (encoding order)
 *   • <bookmark>{table,window,cards,...} → <workbook><worksheets><worksheet> + <windows><window>
 *
 * The bookmark's OWN <cards> is the block the hand-authored `.xml` templates all omit
 * (the load-failure class this format retires); carrying the window through verbatim
 * gets it for free. The donor <datasources> is deliberately DROPPED — the target
 * workbook has its own.
 */
export function bookmarkToTemplateWorkbook(
  rawXml: string,
  inf: Inference,
): { xml: string; hasCards: boolean; bareRefs: string[] } {
  const xml = normalizeBookmarkXml(rawXml);
  const bookmarkOpen = xml.match(/<bookmark\b[^>]*>/)?.[0] ?? '';
  // The emitted fragments retain prefixed attributes, so their declarations must move to the new root.
  const namespaceDeclarations = [
    ...bookmarkOpen.matchAll(/\s(xmlns:[A-Za-z_][\w.-]*=(?:'[^']*'|"[^"]*"))/g),
  ].map((match) => match[1]);
  const workbookNamespaces =
    namespaceDeclarations.length > 0 ? ` ${namespaceDeclarations.join(' ')}` : '';

  const tableM = xml.match(/<table>[\s\S]*<\/table>/);
  const windowM = xml.match(/<window\b[^>]*>[\s\S]*<\/window>/);
  const table = tableM ? tableM[0] : '<table />';
  const windowInner = windowM
    ? windowM[0].replace(/^<window\b[^>]*>/, '').replace(/<\/window>$/, '')
    : '';
  // Worksheet-window highlights are transient UI state and may reference fields absent from the bookmark dictionary.
  const stableWindowInner = windowInner
    .replace(/<highlight\b[^>]*>[\s\S]*?<\/highlight>/g, '')
    .replace(/<highlight\b[^>]*\/>/g, '');
  // <cards> is usually a SIBLING of <table> at the bookmark root, not nested in
  // <window> — most corpus bookmarks carry it at root. HOIST a root-level <cards>
  // into the emitted <window>; looking only inside <window> silently discards it for
  // most bookmarks and re-creates the exact defect the bookmark format was meant to fix.
  const rootCardsM = xml.match(/<cards>[\s\S]*?<\/cards>/);
  const nestedCards = /<cards>/.test(stableWindowInner);
  const hoisted = !nestedCards && !!rootCardsM;
  const windowBody = nestedCards
    ? stableWindowInner
    : `${rootCardsM ? rootCardsM[0] : ''}${stableWindowInner}`;
  const hasCards = nestedCards || hoisted;

  let body = `<worksheet name='{{TITLE}}'>\n${table}\n</worksheet>`;
  let win = `<window class='worksheet' name='{{TITLE}}'>${windowBody}</window>`;

  // Parameterize the DONOR DATASOURCE. A bookmark hard-codes its own datasource's
  // INTERNAL name ("federated.0sws74t0..." / "Sample - Superstore") on
  // <datasource name>, <datasource-dependencies datasource>, and on every qualified
  // encoding ref. rewriteFieldReferences only rewrites refs shaped
  // `[{{DATASOURCE}}].[deriv:field:role]` (fieldReferenceRewriter.ts), so leaving the
  // donor name in place means nothing is rewritten and every slot reports unresolved.
  //
  // BRACKET ESCAPING: inside a bracketed reference Tableau doubles a literal `]`, so a
  // datasource named `TestV1 [Starbucks] Connection` appears on the ATTRIBUTE verbatim
  // but in refs as `[TestV1 [Starbucks]] Connection]`. Try the escaped (longer, more
  // specific) spelling FIRST so the attribute spelling can't partially shadow it.
  const dsVariants = [...inf.donorDatasourceNames]
    .flatMap((n) => (n.includes(']') ? [n.replace(/\]/g, ']]'), n] : [n]))
    .sort((a, b) => b.length - a.length);
  for (const dsName of dsVariants) {
    const esc = dsName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(esc, 'g');
    body = body.replace(re, '{{DATASOURCE}}');
    win = win.replace(re, '{{DATASOURCE}}');
  }
  // Donor captions on <datasource> would resurface the donor's identity in the output.
  const dropCaption = /(<datasource\b[^>]*?)\s+caption='[^']*'/g;
  body = body.replace(dropCaption, '$1');
  win = win.replace(dropCaption, '$1');

  // semantic-role values are fixed geo vocabulary, not field references. Table-calc
  // addressing attrs are tokenized only when their base is a mapped slot; their bare shape is
  // preserved and the bareRefs gate keeps them out of pass 1 until apply can rewrite them.
  //
  // calculation@formula is DELIBERATELY tokenized (NOT shielded — task #28). A donor calc's
  // BASE-INPUT refs are bare `[Field]` names in the SAME datasource (verified: no `.tbm` calc
  // formula carries a datasource-qualified `].[` ref), and inference decomposes every base
  // input into its own bindable slot (inferSlots.ts). Tokenizing them to `{{field_base_N}}`
  // lets the rewriter's §3b formula pass (fieldReferenceRewriter.ts:rewriteFormulaFieldRefs)
  // rebind them to the BOUND target fields — exactly what the curated `.xml` calc templates
  // already do (e.g. deviation-diverging-bar: `formula='SUM([{{field_base_2}}])/SUM([{{field_base_3}}])'`).
  // Leaving the formula shielded stranded the donor names, so the emitted calc referenced
  // fields absent from the target and Tableau silently stripped it (the calc-guard failure
  // class). Nested `[Calculation_*]` refs are NOT base inputs (baseInputsOf skips them) and are
  // handled separately by per-apply calc namespacing (fieldReferenceRewriter.ts §0).
  const PROTECTED_ATTRS = /\b(semantic-role|ordering-field|field)='([^']*)'/g;
  // Sentinel uses U+0001 (\u0001) delimited indices: control chars cannot appear in well-formed
  // XML, so the placeholder can never collide with real document content.
  const shield: string[] = [];
  const protectAttrs = (s: string): string =>
    s.replace(PROTECTED_ATTRS, (whole, attrName: string, attrValue: string) => {
      const hasMappedSlotRef =
        attrName !== 'semantic-role' &&
        inf.slots.some(({ sourceField }) => {
          const escaped = sourceField.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          return (
            parseInstanceRef(attrValue).base === sourceField ||
            new RegExp(`:${escaped}(?=:)`).test(attrValue)
          );
        });
      return hasMappedSlotRef ? whole : `\u0001${shield.push(whole) - 1}\u0001`;
    });
  const restoreAttrs = (s: string): string =>
    // eslint-disable-next-line no-control-regex -- the U+0001 sentinel is intentional (see above).
    s.replace(/\u0001(\d+)\u0001/g, (_m, i: string) => shield[Number(i)]);

  body = protectAttrs(body);
  win = protectAttrs(win);

  // Tokenize base names inside column-instance refs. Longest-first so a name that is a
  // prefix of another ("Sales" vs "Sales Forecast") can't be partially rewritten. The
  // lookbehind/lookahead pins the match to a bracketed `:base:` or `[base]` segment.
  // The token comes from the slot's own `templateField` — assigned per DISTINCT base in
  // inference — so a field placed at multiple date parts (several slots) shares one token
  // and every occurrence rewrites to it. Dedup by base: replacing all occurrences once
  // per distinct base is enough (a second pass for another derivation would be a no-op).
  const tokenOf = new Map(inf.slots.map((s) => [s.sourceField, s.templateField]));
  const ordered = [...tokenOf.keys()].sort((a, b) => b.length - a.length);
  for (const sourceField of ordered) {
    const tok = tokenOf.get(sourceField)!;
    const esc = sourceField.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(?<=[:\\[])${esc}(?=[:\\]])`, 'g');
    body = body.replace(re, tok);
    win = win.replace(re, tok);
  }

  body = restoreAttrs(body);
  win = restoreAttrs(win);

  // BARE-BASE REFS: `[{{DATASOURCE}}].[{{field_base_N}}]` with no `deriv:field:role`
  // segment. The rewriter's qualified-ref regex requires all three colon parts, so this
  // form is NEVER rewritten and the token survives → the residue guard throws "binding
  // is incomplete". Real bookmarks emit it on `<table-calc ordering-field>`. Returned so
  // callers can size the gap against the corpus rather than one file.
  const bareRefs = [
    ...new Set(
      [...`${body}${win}`.matchAll(/\[\{\{DATASOURCE\}\}\]\.\[(\{\{field_base_\d+\}\})\]/g)].map(
        (m) => m[1],
      ),
    ),
  ];

  return {
    xml: `<?xml version='1.0' encoding='utf-8' ?>\n<workbook${workbookNamespaces}>\n<worksheets>\n${body}\n</worksheets>\n<windows>\n${win}\n</windows>\n</workbook>`,
    hasCards,
    bareRefs,
  };
}

/**
 * Parse a normalized bookmark into a DOM and expose the two helpers inference needs:
 * `all(tag)` (descendant-anywhere lookup, matching the probe's getElementsByTagName
 * traversal) and `attr(el, name)`. Kept here so inferSlots.ts and any future reader
 * share one parse path.
 */
export function parseBookmarkDom(rawXml: string): {
  all: (tag: string) => Element[];
  attr: (el: Element, a: string) => string;
} {
  const doc = new DOMParser().parseFromString(normalizeBookmarkXml(rawXml), 'text/xml');
  return {
    all: (tag: string) => Array.from(doc.getElementsByTagName(tag)) as unknown as Element[],
    attr: (el: Element, a: string): string =>
      (el as unknown as { getAttribute?: (n: string) => string | null }).getAttribute?.(a) ?? '',
  };
}
