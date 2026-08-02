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
// Ported verbatim from the proven §0 probe (scripts/local/tbmBindProbe.mts, 74/74 on
// two unrelated datasources). Every behaviour below was empirically required — each
// one, when absent, produced a silent wrong answer or a hard inject failure.

import { DOMParser } from '@xmldom/xmldom';

import type {
  CommunicativeRole,
  Derivation,
  SlotKind,
  TableCalcFact,
} from '../binder/manifest-types.js';

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
  formula: string;
  baseInputs: string[];
}

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
   * manifest and the tokenized XML both read this field, so they agree by construction.
   */
  templateField: string;
  caption: string;
  shelves: Shelf[];
  kind: SlotKind;
  derivation: Derivation;
  required: boolean;
  /** What the slot COMMUNICATES — a single semantic descriptor derived from kind + derivation + placement. */
  role: CommunicativeRole;
  purpose: string;
  tier: 'primary' | 'advanced';
  /** TABLE-CALC semantics when this measure carries a quick/custom table calc; absent otherwise. */
  tableCalc?: TableCalcFact;
}

export interface Inference {
  slots: InferredSlot[];
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

/**
 * Canonical derivation short-forms the binder keys qualified slots on
 * (`template_field@derivation`, explicit-bind.ts:291). Mirrors the Derivation union
 * in manifest-types.ts.
 */
const DERIVATIONS = new Set<string>([
  'none',
  'sum',
  'avg',
  'cnt',
  'cntd',
  'median',
  'min',
  'max',
  'attr',
  'usr',
  'yr',
  'qr',
  'mn',
  'wk',
  'dy',
  'hr',
  'mi',
  'sc',
  'tyr',
  'tqr',
  'tmn',
  'tdy',
]);

/**
 * Table-calc CI-name WRAPPER prefixes. A quick table calc keeps the base measure's
 * aggregation and PREPENDS one or more of these to the column-instance name, chaining
 * right-to-left (`pcdf:cum:sum:Sales:qk` = SUM → cumulative → percent diff). They are NOT
 * in the `Derivation` union (they don't drive the binder's mapping key — the underlying
 * aggregation does), but `parseInstanceRef` must recognize them so a compound name still
 * resolves to its base field + binding aggregation instead of mis-splitting to
 * `base: 'sum:Sales'` and dropping the slot as `kind: unknown`. Source: the confirmed CI
 * prefixes in resources/desktop/knowledge/tactics/data/table-calcs.md.
 */
const TABLECALC_PREFIXES = new Set<string>([
  'cum', // Running Total / YTD (CumTotal)
  'diff', // Difference
  'pcdf', // Percent Difference / YoY (PctDiff)
  'pcto', // Percent of Total (PctTotal)
  'rank', // Rank
  'pcrk', // Percentile (PctRank)
  'win', // Moving Average / window (WindowTotal)
]);

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
  // Consume leading known derivation / table-calc wrapper segments, never taking the
  // second-to-last segment (the base must keep at least one segment before the role marker).
  const consumed: string[] = [];
  let i = 0;
  while (
    i < parts.length - 2 &&
    (DERIVATIONS.has(parts[i].toLowerCase()) || TABLECALC_PREFIXES.has(parts[i].toLowerCase()))
  ) {
    consumed.push(parts[i].toLowerCase());
    i++;
  }
  if (consumed.length > 0) {
    // Binding derivation = the last consumed segment that is a real aggregation/date-part
    // derivation (a table-calc wrapper like `cum`/`pcdf` is not one), else `none`.
    const agg = [...consumed].reverse().find((d) => DERIVATIONS.has(d)) ?? 'none';
    return { base: parts.slice(i, -1).join(':'), derivation: agg as Derivation };
  }
  // No known leading prefix: parts[0] still occupies the (untrusted) derivation slot.
  const d = parts[0].toLowerCase();
  return {
    base: parts.slice(1, -1).join(':'),
    derivation: (DERIVATIONS.has(d) ? d : 'none') as Derivation,
  };
}

/**
 * Repair the two format defects that make OLD Desktop-authored bookmarks unparseable
 * (found empirically across a 1,620-bookmark corpus, versions 4.7 → 8.0):
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
 * Two things happen here, and they must come from ONE pass so the manifest's
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

  const tableM = xml.match(/<table>[\s\S]*<\/table>/);
  const windowM = xml.match(/<window\b[^>]*>[\s\S]*<\/window>/);
  const table = tableM ? tableM[0] : '<table />';
  const windowInner = windowM
    ? windowM[0].replace(/^<window\b[^>]*>/, '').replace(/<\/window>$/, '')
    : '';
  // <cards> is usually a SIBLING of <table> at the bookmark root, not nested in
  // <window> — most corpus bookmarks carry it at root. HOIST a root-level <cards>
  // into the emitted <window>; looking only inside <window> silently discards it for
  // most bookmarks and re-creates the exact defect the bookmark format was meant to fix.
  const rootCardsM = xml.match(/<cards>[\s\S]*?<\/cards>/);
  const nestedCards = /<cards>/.test(windowInner);
  const hoisted = !nestedCards && !!rootCardsM;
  const windowBody = nestedCards ? windowInner : `${rootCardsM ? rootCardsM[0] : ''}${windowInner}`;
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

  // ATTRIBUTES THAT MUST NOT BE TOKENIZED — they carry bracketed values that LOOK like
  // field references but are not:
  //   - semantic-role='[State].[Name]' — Tableau's fixed geo-hierarchy vocabulary. A
  //     donor field literally named "State" would otherwise become
  //     semantic-role='[N].[Name]', which the rewriter can't map, so the token survives
  //     and the whole inject throws (the single largest failure cause in the corpus).
  //   - calculation@formula / @column — a formula names the donor's own calc columns;
  //     the binder rebinds a calc's BASE INPUTS, it does not rewrite formula text.
  //   - table-calc@ordering-field — emits the BARE `[ds].[base]` form the rewriter's
  //     three-part regex can't match.
  const PROTECTED_ATTRS = /\b(semantic-role|formula|ordering-field)='[^']*'/g;
  // Sentinel uses U+0001 (\u0001) delimited indices: control chars cannot appear in well-formed
  // XML, so the placeholder can never collide with real document content.
  const shield: string[] = [];
  const protectAttrs = (s: string): string =>
    s.replace(PROTECTED_ATTRS, (whole) => `\u0001${shield.push(whole) - 1}\u0001`);
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
    xml: `<?xml version='1.0' encoding='utf-8' ?>\n<workbook>\n<worksheets>\n${body}\n</worksheets>\n<windows>\n${win}\n</windows>\n</workbook>`,
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
