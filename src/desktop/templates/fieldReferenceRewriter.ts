import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { createHash } from 'crypto';
import * as xpath from 'xpath';

// =============================================================================
// LOCKSTEP-CORE CANDIDATE — shared DOM-structural field-reference rewriter.
// -----------------------------------------------------------------------------
// This is the convergence keystone: the single DOM-structural rewrite body that
// both this repo (tableau-mcp) and the source authoring repo (agent-to-tableau-
// desktop) are converging onto. It is intentionally PURE — no fs, no MCP, no
// zod, no logging — and its imports are kept minimal and repo-agnostic
// (@xmldom/xmldom + xpath + node crypto) so a future step can promote it to a
// byte-identical shared core imported by both repos. Do NOT add repo-specific
// imports (config, logging, error types, zod) here; keep those in callers.
//
// RAW-vs-ESCAPED BOUNDARY (named contract):
//   The rewriter takes RAW (UNESCAPED) inputs — the `fieldMapping` values and
//   the `datasourceName` are plain strings exactly as the caller holds them. ALL
//   XML escaping is produced EXCLUSIVELY by DOM serialization at the end of this
//   function (setAttribute / text-node writes escape once when serialized).
//   Callers MUST NOT pre-escape mapping values or the datasource name — doing so
//   double-escapes (`&` → `&amp;amp;`). A metachar-bearing field name (e.g.
//   `R&D <Team>`) is therefore escaped EXACTLY ONCE in the output. See the
//   colocated `fieldReferenceRewriter.test.ts` "raw-vs-escaped" proof.
//
// DOM-STRUCTURAL passes (per reference class), in order:
//   0. (opt-in) per-apply calc namespacing
//   1. base <column> name + metadata
//   2. <column-instance column=...> base-column rename
//   3. <column-instance name=...> incl. COMPOUND (table-calc) derivations
//   3b/3b-ii. calc <calculation formula> + calc <column caption> field refs
//   3c. filter member neutralization for remapped filtered fields
//   4/5. datasource-qualified refs in text nodes + attribute values
//   final. remaining {{DATASOURCE}} fill; <run> CDATA wrapping
//
// DELIBERATE DEVIATIONS FROM A (report before lockstep can be byte-identical):
//   - `namespaceCalcs` defaults to FALSE here (A defaults TRUE). A's default-on
//     path folds in a `randomUUID()` nonce generated INSIDE the function, which
//     is impure/nondeterministic — unacceptable for a pure, characterizable core
//     and for deterministic tests. Here namespacing runs only when explicitly
//     enabled AND given a caller-supplied `applyNonce`; the module never mints a
//     nonce itself. This also preserves the prior tableau-mcp behavior (the old
//     rewriter never namespaced), so the thin wrapper stays behavior-compatible.
//   - The final bare-`{{DATASOURCE}}` fill uses a REPLACER FUNCTION rather than a
//     replacement string, so `$`-sequences in the datasource name (e.g. `A$$B$1`)
//     are inserted literally instead of being treated as `$&`/`$1` back-refs.
// =============================================================================

// DOM nodeType constants — `Node` is not a global value in the desktop runtime,
// so compare against the numeric constants directly.
const TEXT_NODE = 3;
const ELEMENT_NODE = 1;
const ATTRIBUTE_NODE = 2;

/** Resolved actual-field info written into the template for a mapped field. */
interface FieldInfo {
  /** Actual base field name, e.g. `Profit`. */
  name: string;
  /** Lowercase derivation SHORT code for instance names/shelf refs, e.g. `sum`. */
  derivation: string;
  /** Capitalized derivation LONG form for the `derivation` attribute, e.g. `Sum`. */
  derivationAttr: string;
  /** Role marker, e.g. `qk`/`nk`. */
  role: string;
}

/** Per-apply options for {@link rewriteFieldReferences}. */
export interface RewriteFieldReferencesOptions {
  /**
   * Namespace the template's OWN calc columns (a `<column>` owning a
   * `<calculation>`, whose name is NOT a dataset-bound field) with a
   * deterministic per-apply suffix so a stale same-named calc already on the
   * target datasource cannot SHADOW them. Defaults to FALSE (see the deviation
   * note above); when TRUE an {@link RewriteFieldReferencesOptions.applyNonce}
   * MUST be supplied — this pure core never generates its own nonce.
   */
  namespaceCalcs?: boolean;
  /**
   * Deterministic per-apply nonce folded into the calc-name suffix. Required
   * when `namespaceCalcs` is true; two applies with different nonces get
   * collision-free names.
   */
  applyNonce?: string;
  /**
   * Manifest-declared bindable slots. When supplied, unused optional slots are
   * removed structurally and any unresolved required slot fails before apply.
   */
  templateSlots?: readonly TemplateSlotReference[];
}

/** Minimal, repo-agnostic manifest slot shape needed by the rewrite guard. */
export interface TemplateSlotReference {
  template_field: string;
  required: boolean;
  bindable?: boolean;
  kind?: string;
  role?: readonly string[];
}

/**
 * CANONICAL short-form → long-form derivation map (adopted from A as the single
 * source of truth for this core). A column-instance NAME carries the lowercase
 * short code (`[sum:Sales:qk]`); the sibling `derivation` ATTRIBUTE carries the
 * capitalized long form (`Sum`, `Month-Trunc`). Writing a long form INTO an
 * instance name fails to bind in live Desktop (red pills / blank viz).
 */
const DERIVATION_SHORT_TO_LONG: Readonly<Record<string, string>> = {
  // Aggregations
  none: 'None',
  sum: 'Sum',
  avg: 'Avg',
  cnt: 'Count',
  count: 'Count',
  cntd: 'CountD',
  ctd: 'CountD',
  countd: 'CountD',
  median: 'Median',
  attr: 'Attr',
  min: 'Min',
  max: 'Max',
  stdev: 'Stdev',
  stdevp: 'StdevP',
  var: 'Var',
  varp: 'VarP',
  // Table calc / user
  usr: 'User',
  user: 'User',
  // Discrete date parts
  yr: 'Year',
  qr: 'Quarter',
  mn: 'Month',
  wk: 'Week',
  dy: 'Day',
  hr: 'Hour',
  mi: 'Minute',
  sc: 'Second',
  // Date truncations (continuous *-Trunc long forms)
  tyr: 'Year-Trunc',
  tqr: 'Quarter-Trunc',
  tmn: 'Month-Trunc',
  tmo: 'Month-Trunc',
  twk: 'Week-Trunc',
  tdy: 'Day-Trunc',
};

/**
 * Replace `{{DATASOURCE}}` placeholders AND template field names with actual
 * values, structurally (per reference class) over the parsed DOM.
 *
 * @param templateXml - Template XML with `{{DATASOURCE}}` placeholders and template field names.
 * @param fieldMapping - Map of template field names to actual column-instance format (e.g. `{ "Sales": "[sum:Sales:qk]" }`).
 *   Keys may be bare (`"Sales"`) or derivation-qualified (`"Order Date@yr"`); qualified keys take precedence for instances
 *   whose template derivation matches, letting one base field carry several derivations independently. Values are RAW.
 * @param datasourceName - Actual (RAW) datasource name to substitute for `{{DATASOURCE}}`.
 * @param fieldMetadata - Optional datatype/type overrides applied to renamed base `<column>` definitions.
 * @param options - Per-apply options; see {@link RewriteFieldReferencesOptions}.
 * @returns Modified XML with datasource and field references replaced (escaped once via serialization).
 */
export function rewriteFieldReferences(
  templateXml: string,
  fieldMapping: Record<string, string>,
  datasourceName: string,
  fieldMetadata?: Record<string, { datatype: string; type: string }>,
  options?: RewriteFieldReferencesOptions,
): string {
  // Parse with a silent error handler — the upstream caller validates the
  // post-transform result and reports problems there.
  const parser = new DOMParser({
    errorHandler: (): void => {},
  });
  const doc = parser.parseFromString(templateXml, 'text/xml') as unknown as Document;

  const derivationMap = DERIVATION_SHORT_TO_LONG;

  // Parse a mapped column-instance value into the actual field info we write.
  // Accepts [datasource].[derivation:fieldName:role] or [derivation:fieldName:role].
  const parseColumnInstance = (columnInstance: string): FieldInfo | null => {
    const strippedInstance = columnInstance.includes('].[')
      ? columnInstance.substring(columnInstance.indexOf('].[') + 2)
      : columnInstance;

    const match = strippedInstance.match(/\[([^:]+):([^:]+):([^\]]+)\]/);
    if (!match) {
      return null;
    }

    const [, derivShortRaw, actualFieldName, role] = match;
    const derivation = derivShortRaw.toLowerCase();
    const derivationAttr = derivationMap[derivation] || derivShortRaw;
    return { name: actualFieldName, derivation, derivationAttr, role };
  };

  // A mapping key is either a bare template field name ("Order Date") or a
  // derivation-qualified key ("Order Date@yr"). A key is only treated as
  // qualified when the text after the last '@' looks like a derivation
  // short-form token — real field names virtually never contain '@'.
  const bareKeyInfo: Record<string, FieldInfo> = {};
  const qualifiedKeyInfo: Record<string, FieldInfo> = {}; // key = "field@deriv" (deriv lowercased)

  for (const [rawKey, columnInstance] of Object.entries(fieldMapping)) {
    const parsed = parseColumnInstance(columnInstance);
    if (!parsed) continue;
    const atIdx = rawKey.lastIndexOf('@');
    const suffix = atIdx >= 0 ? rawKey.substring(atIdx + 1) : '';
    if (atIdx > 0 && /^[A-Za-z][A-Za-z0-9-]*$/.test(suffix)) {
      const field = rawKey.substring(0, atIdx);
      qualifiedKeyInfo[`${field}@${suffix.toLowerCase()}`] = parsed;
    } else {
      bareKeyInfo[rawKey] = parsed;
    }
  }

  // Bare template field names appearing anywhere in the mapping (bare key or the
  // field part of a qualified key). Used to decide "is this field remapped?".
  const mappedFields = new Set<string>();
  for (const k of Object.keys(bareKeyInfo)) mappedFields.add(k);
  for (const k of Object.keys(qualifiedKeyInfo))
    mappedFields.add(k.substring(0, k.lastIndexOf('@')));

  // Remove optional placeholders while the DOM still carries template names.
  // Doing this before mapped fields are renamed avoids confusing an actual user
  // field whose name happens to equal another slot's template placeholder.
  pruneUnusedOptionalTemplateSlots(doc, fieldMapping, mappedFields, options?.templateSlots);

  // 0. Per-apply CALC NAMESPACING (opt-in; requires a caller-supplied nonce).
  if (options?.namespaceCalcs && options.applyNonce) {
    const suffix = calcNamespaceSuffix(templateXml, options.applyNonce);
    namespaceTemplateCalcColumns(doc, mappedFields, suffix);
  }

  // Derivation-aware resolution: a qualified key matching the template
  // derivation wins; otherwise the bare key is the fallback.
  const resolveFieldInfo = (field: string, templateDeriv?: string): FieldInfo | undefined => {
    if (templateDeriv) {
      const q = qualifiedKeyInfo[`${field}@${templateDeriv.toLowerCase()}`];
      if (q) return q;
    }
    return bareKeyInfo[field];
  };

  // Single target BASE column name per mapped template field. All derivations of
  // one field must rename its base <column> to the SAME target; a caller mapping
  // qualifiers of one field to different base columns is a corruption — fail loud.
  const baseTarget: Record<string, string> = {};
  for (const field of mappedFields) {
    const names = new Set<string>();
    if (bareKeyInfo[field]) names.add(bareKeyInfo[field].name);
    for (const [qk, info] of Object.entries(qualifiedKeyInfo)) {
      if (qk.substring(0, qk.lastIndexOf('@')) === field) names.add(info.name);
    }
    if (names.size > 1) {
      throw new Error(
        `Field mapping for template field '${field}' resolves to multiple base columns ` +
          `(${Array.from(names)
            .map((n) => `[${n}]`)
            .join(', ')}). All derivations of one template field must map to the same base column.`,
      );
    }
    if (names.size === 1) {
      baseTarget[field] = names.values().next().value as string;
    }
  }

  // 1. Base <column> name attributes and metadata: <column name='[Region]' .../>
  const baseColumns = selectElements('//column[@name]', doc);
  for (const col of baseColumns) {
    const nameValue = col.getAttribute('name');
    if (!nameValue) continue;
    const simpleMatch = nameValue.match(/^\[([^\]:]+)\]$/);
    if (simpleMatch && mappedFields.has(simpleMatch[1])) {
      const templateFieldName = simpleMatch[1];
      col.setAttribute('name', `[${baseTarget[templateFieldName]}]`);

      if (fieldMetadata && fieldMetadata[templateFieldName]) {
        const meta = fieldMetadata[templateFieldName];
        if (col.hasAttribute('datatype')) col.setAttribute('datatype', meta.datatype);
        if (col.hasAttribute('type')) col.setAttribute('type', meta.type);
      }
    }
  }

  // 2. <column-instance column='[Region]'> base-column rename.
  const columnInstances = selectElements('//column-instance[@column]', doc);
  for (const colInst of columnInstances) {
    const columnValue = colInst.getAttribute('column');
    if (!columnValue) continue;
    const simpleMatch = columnValue.match(/^\[([^\]:]+)\]$/);
    if (simpleMatch && mappedFields.has(simpleMatch[1])) {
      colInst.setAttribute('column', `[${baseTarget[simpleMatch[1]]}]`);
    }
  }

  // 3. <column-instance name='[sum:Region:nk]'> — instance NAME keeps the
  //    lowercase short-form prefix; the `derivation` attribute gets the
  //    capitalized long form. parseInstanceName is colon-tolerant so COMPOUND
  //    (table-calc) derivations — e.g. [cum:sum:Profit:qk] — resolve correctly.
  for (const colInst of columnInstances) {
    const nameValue = colInst.getAttribute('name');
    if (!nameValue) continue;
    const parsed = parseInstanceName(nameValue);
    if (!parsed || !mappedFields.has(parsed.field)) continue;
    const { deriv: tDeriv, field: tField, trailing: tTrailing } = parsed;
    const fieldInfo = resolveFieldInfo(tField, tDeriv);

    if (tDeriv.includes(':')) {
      // COMPOUND (table-calc) derivation: preserve the wrapper + role, swap only
      // the base-aggregation segment (the last one) + the field name.
      const derivParts = tDeriv.split(':');
      const newField = fieldInfo ? fieldInfo.name : baseTarget[tField];
      if (!newField) continue;
      if (fieldInfo) derivParts[derivParts.length - 1] = fieldInfo.derivation;
      colInst.setAttribute('name', `[${derivParts.join(':')}:${newField}:${tTrailing}]`);
      if (fieldInfo && colInst.hasAttribute('derivation')) {
        colInst.setAttribute('derivation', fieldInfo.derivationAttr);
      }
      continue;
    }

    if (fieldInfo) {
      colInst.setAttribute('name', `[${fieldInfo.derivation}:${fieldInfo.name}:${fieldInfo.role}]`);
      if (colInst.hasAttribute('derivation')) {
        colInst.setAttribute('derivation', fieldInfo.derivationAttr);
      }
    } else {
      // Field remapped but this derivation isn't; keep template deriv/role and
      // just point at the renamed base column so the instance doesn't dangle.
      colInst.setAttribute('name', `[${tDeriv}:${baseTarget[tField]}:${tTrailing}]`);
    }
  }

  // 3b. Rewrite bare [FieldName] refs inside calc formula bodies. When the
  //   remap changed the formula and the owning column carries a purely human
  //   caption (no `[..]` token), the template's caption now misnames the calc
  //   (and can duplicate an existing datasource caption) — derive an honest one.
  const calcElements = selectElements('//calculation[@formula]', doc);
  for (const calc of calcElements) {
    const formula = calc.getAttribute('formula');
    if (formula) {
      const rewritten = rewriteFormulaFieldRefs(formula, baseTarget);
      if (rewritten !== formula) {
        calc.setAttribute('formula', rewritten);
        const col = calc.parentNode as Element | null;
        if (col && col.nodeType === 1 && (col as Element).tagName === 'column') {
          const caption = (col as Element).getAttribute('caption');
          if (caption && !caption.includes('[')) {
            const derived = deriveRemappedCalcCaption(caption, formula, rewritten, baseTarget);
            if (derived && derived !== caption) (col as Element).setAttribute('caption', derived);
          }
        }
      }
    }
  }

  // 3b-ii. Rewrite bare [FieldName] refs inside a calc COLUMN's caption (an
  //   auto-named calc's caption mirrors its formula). Only bracket-bearing
  //   captions are touched, so a purely human caption is left verbatim.
  const calcColumns = selectElements('//column[calculation]', doc);
  for (const col of calcColumns) {
    const caption = col.getAttribute('caption');
    if (caption && caption.includes('[')) {
      const rewritten = rewriteFormulaFieldRefs(caption, baseTarget);
      if (rewritten !== caption) col.setAttribute('caption', rewritten);
    }
  }

  // 3c. Neutralize hard-coded filter members when the filtered field was
  //     remapped: collapse to the canonical "all members at this level"
  //     groupfilter so the viz doesn't render blank against target data.
  const filterElements = selectElements('//filter', doc);
  for (const filter of filterElements) {
    const colAttr = filter.getAttribute('column');
    if (!colAttr) continue;
    const cm = colAttr.match(/^\[[^\]]*\]\.\[([^:]+):([^:]+):([^:\]]+)\]$/);
    if (!cm) continue;
    const [, tDeriv, tField, tRole] = cm;
    if (!mappedFields.has(tField)) continue;

    const info = resolveFieldInfo(tField, tDeriv);
    const baseName = baseTarget[tField];
    const deriv = info ? info.derivation : tDeriv;
    const role = info ? info.role : tRole;

    if (baseName === tField && deriv === tDeriv) continue;

    if (filter.getElementsByTagName('groupfilter').length === 0) continue;

    const mappedCi = `[${deriv}:${baseName}:${role}]`;
    filter.setAttribute('column', `[${datasourceName}].${mappedCi}`);
    while (filter.firstChild) {
      filter.removeChild(filter.firstChild);
    }
    const neutral = doc.createElement('groupfilter');
    neutral.setAttribute('function', 'level-members');
    neutral.setAttribute('level', mappedCi);
    filter.appendChild(neutral);
  }

  // Shared rewrite for datasource-qualified field references in text nodes and
  // attribute values: [{{DATASOURCE}}].[<templateDeriv>:<field>:<role>].
  const rewriteQualifiedRefs = (input: string): string => {
    let out = input;
    for (const field of mappedFields) {
      // The pre-field derivation segment may be COMPOUND (colons allowed) for
      // table-calc refs; escapeRegex guards the user-derived field token.
      const regex = new RegExp(
        `\\[\\{\\{DATASOURCE\\}\\}\\]\\.\\[([^\\[\\]]+?):${escapeRegex(field)}:([^\\[\\]]+)\\]`,
        'g',
      );
      out = out.replace(regex, (whole, templateDeriv: string, templateTrailing: string) => {
        const info = resolveFieldInfo(field, templateDeriv);
        if (templateDeriv.includes(':')) {
          const newField = info ? info.name : baseTarget[field];
          if (!newField) return whole;
          const derivParts = templateDeriv.split(':');
          if (info) derivParts[derivParts.length - 1] = info.derivation;
          return `[${datasourceName}].[${derivParts.join(':')}:${newField}:${templateTrailing}]`;
        }
        if (!info) return whole;
        return `[${datasourceName}].[${info.derivation}:${info.name}:${info.role}]`;
      });
    }
    return out;
  };

  // 4. Field references in text content.
  const allText = selectTexts('//text()', doc);
  for (const textNode of allText) {
    const newText = rewriteQualifiedRefs(textNode.data);
    if (newText !== textNode.data) textNode.data = newText;
  }

  // 5. Field references in attribute values.
  const allElements = selectElements('//*[@*]', doc);
  for (const elem of allElements) {
    const attrs = Array.from(elem.attributes) as Attr[];
    for (const attr of attrs) {
      const newValue = rewriteQualifiedRefs(attr.value);
      if (newValue !== attr.value) attr.value = newValue;
    }
  }

  // Fill remaining {{DATASOURCE}} placeholders in text nodes and attribute
  // values. Replacer FUNCTIONS keep `$`-sequences in the datasource name literal.
  const allNodes = xpath.select('//text() | //*/@*', doc as unknown as Node) as Node[];
  for (const node of allNodes) {
    if (node.nodeType === TEXT_NODE) {
      const textNode = node as Text;
      const newText = textNode.data.replace(/\{\{DATASOURCE\}\}/g, () => datasourceName);
      if (newText !== textNode.data) textNode.data = newText;
    } else if (node.nodeType === ATTRIBUTE_NODE) {
      const attrNode = node as Attr;
      const newValue = attrNode.value.replace(/\{\{DATASOURCE\}\}/g, () => datasourceName);
      if (newValue !== attrNode.value) attrNode.value = newValue;
    }
  }

  // Defense in depth after every substitution pass: a required template field
  // that was not successfully mapped must never reach Desktop as a literal
  // sample-data column. Optional cleanup is verified here for the same reason.
  assertNoUnresolvedTemplateSlots(
    doc,
    mappedFields,
    baseTarget,
    options?.templateSlots,
  );

  // Wrap <run> text with newlines / angle brackets in CDATA (matches Tableau).
  const runElements = selectElements('//run', doc);
  for (const run of runElements) {
    const textNode = Array.from(run.childNodes).find((n) => n.nodeType === TEXT_NODE) as
      | Text
      | undefined;
    if (textNode) {
      const text = textNode.data;
      if (text.includes('\n') || text.includes('<') || text.includes('>')) {
        textNode.parentNode?.removeChild(textNode);
        run.appendChild((doc as unknown as XMLDocument).createCDATASection(text));
      }
    }
  }

  return new XMLSerializer().serializeToString(doc as any);
}

/**
 * Deterministic short suffix for per-apply calc namespacing. Folds the template
 * identity and a per-apply nonce into a short hex hash: the same (template,
 * nonce) always yields the same suffix; different nonces yield different ones.
 */
export function calcNamespaceSuffix(templateXml: string, applyNonce: string): string {
  return createHash('sha1')
    .update(templateXml)
    .update('\u0000')
    .update(applyNonce)
    .digest('hex')
    .slice(0, 8);
}

// -- XPath narrowing helpers --------------------------------------------------

function selectElements(xp: string, doc: Document): Element[] {
  return (xpath.select(xp, doc as unknown as Node) as Node[]).filter(
    (n): n is Element => n.nodeType === ELEMENT_NODE,
  );
}

function selectTexts(xp: string, doc: Document): Text[] {
  return (xpath.select(xp, doc as unknown as Node) as Node[]).filter(
    (n): n is Text => n.nodeType === TEXT_NODE,
  );
}

const OPTIONAL_REFERENCE_ELEMENTS = new Set([
  'column',
  'column-instance',
  'computed-sort',
  'encoding',
  'filter',
  'format',
  'groupfilter',
  'lod',
]);

function rawMappingFields(fieldMapping: Record<string, string>): Set<string> {
  const fields = new Set<string>();
  for (const key of Object.keys(fieldMapping)) {
    const atIdx = key.lastIndexOf('@');
    const suffix = atIdx >= 0 ? key.substring(atIdx + 1) : '';
    fields.add(atIdx > 0 && /^[A-Za-z][A-Za-z0-9-]*$/.test(suffix) ? key.slice(0, atIdx) : key);
  }
  return fields;
}

function referencesTemplateField(value: string, templateField: string): boolean {
  for (const match of value.matchAll(/\[([^\]]+)\]/g)) {
    const token = match[1];
    if (token === templateField) {
      // In `[datasource].[instance]`, the first bracket token is a datasource,
      // not a field. Do not mistake a same-named datasource for a placeholder.
      const afterToken = value.slice((match.index ?? 0) + match[0].length);
      if (!afterToken.startsWith('.[')) return true;
    }
    if (parseInstanceName(match[0])?.field === templateField) return true;
  }
  return false;
}

function removeElement(element: Element): void {
  element.parentNode?.removeChild(element);
}

function pruneShelfFieldReferences(doc: Document, templateField: string): void {
  for (const tag of ['rows', 'cols']) {
    for (const shelf of selectElements(`//${tag}`, doc)) {
      for (const text of Array.from(shelf.childNodes).filter(
        (node): node is Text => node.nodeType === TEXT_NODE,
      )) {
        if (!referencesTemplateField(text.data, templateField)) continue;
        const kept = text.data
          .split(/\s+\/\s+/)
          .filter((pill) => !referencesTemplateField(pill, templateField));
        text.data = kept.join(' / ');
      }
    }
  }
}

function pruneOptionalTemplateField(doc: Document, templateField: string): void {
  for (const element of selectElements('//*', doc)) {
    if (!OPTIONAL_REFERENCE_ELEMENTS.has(element.tagName)) continue;
    const referencesField = Array.from(element.attributes).some((attribute) =>
      referencesTemplateField(attribute.value, templateField),
    );
    if (referencesField) removeElement(element);
  }
  pruneShelfFieldReferences(doc, templateField);
}

function pruneUnusedOptionalTemplateSlots(
  doc: Document,
  fieldMapping: Record<string, string>,
  mappedFields: Set<string>,
  slots?: readonly TemplateSlotReference[],
): void {
  if (!slots || slots.length === 0) return;
  const rawMappedFields = rawMappingFields(fieldMapping);
  const pruned = new Set<string>();
  for (const slot of slots) {
    if (
      slot.bindable === false ||
      slot.required ||
      mappedFields.has(slot.template_field) ||
      rawMappedFields.has(slot.template_field) ||
      pruned.has(slot.template_field)
    ) {
      continue;
    }
    pruneOptionalTemplateField(doc, slot.template_field);
    pruned.add(slot.template_field);
  }
}

function documentReferencesTemplateField(doc: Document, templateField: string): boolean {
  for (const element of selectElements('//*[@*]', doc)) {
    if (
      Array.from(element.attributes).some((attribute) =>
        referencesTemplateField(attribute.value, templateField),
      )
    ) {
      return true;
    }
  }
  return selectTexts('//text()', doc).some((text) =>
    referencesTemplateField(text.data, templateField),
  );
}

function userFacingFieldDescription(slot: TemplateSlotReference): string {
  switch (slot.kind) {
    case 'quantitative':
      return 'a quantitative value field';
    case 'categorical':
      return 'a categorical field';
    case 'temporal':
      return 'a date field';
    case 'geo':
      return 'a geographic field';
    default:
      return 'a field';
  }
}

function assertNoUnresolvedTemplateSlots(
  doc: Document,
  mappedFields: Set<string>,
  baseTarget: Record<string, string>,
  slots?: readonly TemplateSlotReference[],
): void {
  if (!slots || slots.length === 0) return;
  const unresolved: TemplateSlotReference[] = [];
  const seen = new Set<string>();

  for (const slot of slots) {
    if (slot.bindable === false) continue;
    const mapped = mappedFields.has(slot.template_field);
    if (mapped && baseTarget[slot.template_field] === slot.template_field) continue;
    const survived = documentReferencesTemplateField(doc, slot.template_field);
    if (survived && !seen.has(slot.template_field)) {
      unresolved.push(slot);
      seen.add(slot.template_field);
    }
  }

  if (unresolved.length === 0) return;
  const descriptions = [...new Set(unresolved.map(userFacingFieldDescription))];
  const choice =
    descriptions.length === 1
      ? descriptions[0]
      : `${descriptions.slice(0, -1).join(', ')} and ${descriptions.at(-1)}`;
  const boundUserFields = [...new Set(Object.values(baseTarget))];
  const boundContext =
    boundUserFields.length > 0
      ? ` after binding ${boundUserFields.map((field) => `"${field}"`).join(', ')}`
      : '';
  throw new Error(
    `Template binding is incomplete${boundContext}: choose ${choice} for the chart and retry with a complete field mapping. No worksheet was produced.`,
  );
}

/** Escape special regex characters in field names. */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Parse a column-instance NAME (`[<deriv>:<field>:<role>]`) into its derivation,
 * base field name, and trailing role segment — colon-tolerantly, so COMPOUND
 * (table-calc) derivations survive (e.g. `[cum:sum:Profit:qk]` → deriv
 * `cum:sum`, field `Profit`, trailing `qk`). Anchors on the ROLE marker
 * (`nk`/`ok`/`qk`). Returns null for anything that is not that shape.
 */
function parseInstanceName(
  name: string,
): { deriv: string; field: string; trailing: string } | null {
  const inner = name.match(/^\[([^\]]+)\]$/);
  if (!inner) return null;
  const parts = inner[1].split(':');
  if (parts.length < 3) return null;
  let roleIdx = -1;
  for (let i = parts.length - 1; i >= 1; i--) {
    if (parts[i] === 'nk' || parts[i] === 'ok' || parts[i] === 'qk') {
      roleIdx = i;
      break;
    }
  }
  if (roleIdx < 1) return null;
  const field = parts[roleIdx - 1];
  const deriv = parts.slice(0, roleIdx - 1).join(':');
  const trailing = parts.slice(roleIdx).join(':');
  if (!deriv || !field) return null;
  return { deriv, field, trailing };
}

/**
 * Rewrite bare [FieldName] references inside a calc formula/caption so they
 * follow a field remap. Single-pass over each `[ ... ]` token → handles
 * regex-special field names and prevents chained re-matching.
 */
function rewriteFormulaFieldRefs(formula: string, baseTarget: Record<string, string>): string {
  return formula.replace(/\[([^\]]+)\]/g, (whole, innerName: string) => {
    const target = baseTarget[innerName];
    return target ? `[${target}]` : whole;
  });
}

/**
 * Derive an honest caption for a calc column whose FORMULA field refs were
 * remapped to different base fields while its human caption still names the
 * template's original fields. Live defect (Ben, 2026-07-09 test1.twbx): the
 * correlation-scatter calc kept caption "Profit Ratio" after its formula was
 * rebound to SUM([Profit])/SUM([Discount]) — a second, wrong "Profit Ratio"
 * beside the datasource's real one. Strategy, first hit wins:
 *   1. whole-word-replace remapped old field names inside the caption;
 *   2. humanize the rewritten formula (AGG([X]) → X) when the result is a
 *      short, plain field expression;
 *   3. append the distinct new field names to the original caption.
 * Returns null when nothing was remapped (identity binds keep their caption).
 */
function deriveRemappedCalcCaption(
  caption: string,
  originalFormula: string,
  rewrittenFormula: string,
  baseTarget: Record<string, string>,
): string | null {
  const changedPairs = new Map<string, string>();
  for (const m of originalFormula.matchAll(/\[([^\]]+)\]/g)) {
    const target = baseTarget[m[1]];
    if (target && target !== m[1]) changedPairs.set(m[1], target);
  }
  if (changedPairs.size === 0) return null;

  let replaced = caption;
  for (const [oldName, newName] of changedPairs) {
    const escaped = oldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    replaced = replaced.replace(new RegExp(`\\b${escaped}\\b`, 'g'), newName);
  }
  if (replaced !== caption) return replaced;

  const humanized = rewrittenFormula
    .replace(/\b(?:SUM|AVG|MIN|MAX|MEDIAN|ATTR|COUNTD|COUNT|STDEVP|STDEV|VARP|VAR)\s*\(\s*\[([^\]]+)\]\s*\)/gi, '$1')
    .replace(/\[([^\]]+)\]/g, '$1')
    .replace(/\s*([+\-*/])\s*/g, ' $1 ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!/[[\]()]/.test(humanized) && humanized.length <= 60) return humanized;

  return `${caption} (${Array.from(new Set(changedPairs.values())).join(', ')})`;
}

/**
 * Rewrite every reference to a template-internal calc name in one string, in a
 * SINGLE bracket-token pass, covering both bare form (`[CalcName]`) and
 * column-instance form (`[deriv:CalcName:role]`). Only tokens whose name is a
 * key in `renameMap` are rewritten.
 */
function rewriteCalcRefs(input: string, renameMap: Map<string, string>): string {
  if (!input.includes('[')) return input;
  return input.replace(/\[([^\]]+)\]/g, (whole, inner: string) => {
    const bare = renameMap.get(inner);
    if (bare) return `[${bare}]`;
    const parts = inner.split(':');
    if (parts.length === 3) {
      const renamed = renameMap.get(parts[1]);
      if (renamed) return `[${parts[0]}:${renamed}:${parts[2]}]`;
    }
    return whole;
  });
}

/**
 * Rename the template's OWN calc columns per-apply so a stale same-named calc on
 * the target datasource cannot shadow them. A calc column is a `<column>` that
 * OWNS a `<calculation>` child; dataset-bound names (in `mappedFields`) are never
 * renamed. The rename is applied consistently to every attribute value and text
 * node; `caption` attributes carry no `[..]` token so they stay human-readable.
 */
function namespaceTemplateCalcColumns(
  doc: Document,
  mappedFields: Set<string>,
  suffix: string,
): void {
  const renameMap = new Map<string, string>();
  for (const col of selectElements('//column[calculation]', doc)) {
    const nameAttr = col.getAttribute('name');
    if (!nameAttr) continue;
    const m = nameAttr.match(/^\[([^\]]+)\]$/);
    if (!m) continue;
    const bare = m[1];
    if (mappedFields.has(bare)) continue;
    if (!renameMap.has(bare)) renameMap.set(bare, `${bare}_tpl_${suffix}`);
  }
  if (renameMap.size === 0) return;

  for (const elem of selectElements('//*[@*]', doc)) {
    for (const attr of Array.from(elem.attributes) as Attr[]) {
      const rewritten = rewriteCalcRefs(attr.value, renameMap);
      if (rewritten !== attr.value) attr.value = rewritten;
    }
  }
  for (const textNode of selectTexts('//text()', doc)) {
    const rewritten = rewriteCalcRefs(textNode.data, renameMap);
    if (rewritten !== textNode.data) textNode.data = rewritten;
  }
}
