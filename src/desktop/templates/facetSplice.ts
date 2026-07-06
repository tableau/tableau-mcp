/**
 * Apply-path facet splice (W28-C, ported from a2td server/tools/facet-splice.ts) —
 * make a BOUND optional facet slot RENDER.
 *
 * W27-B armed the optional small-multiples facet slot on trend-line-chart and
 * ranking-ordered-bar: the binder emits `field_mapping["Facet"]`, and the byte-locked
 * field-reference rewriter (src/desktop/templates/fieldReferenceRewriter.ts) renames the
 * OFF-SHELF `[Facet]` base column to the bound dimension. But nothing lands on the
 * rows/cols shelf, so a bound facet is visually a NO-OP.
 *
 * This GLUE step closes that gap WITHOUT touching the byte-locked core. It runs
 * BEFORE the core rewrite, on the RAW template (facet refs still named `[Facet]`),
 * and — only when the mapping actually binds the facet slot — splices a `[Facet]`
 * column-instance pill onto the correct shelf AHEAD of the existing pill, plus the
 * matching `<column-instance>` declaration if absent. The core rewrite that runs
 * next maps every `[Facet]` reference (base column, instance, shelf pill) to the
 * bound field for free, so we reuse the tested engine instead of re-implementing
 * datasource-qualification / derivation normalization / escaping here.
 *
 * INVARIANTS
 *   - Un-faceted apply → returns the input string UNCHANGED (identity), so the
 *     downstream core sees the exact bytes it saw before this feature existed.
 *   - Already-on-shelf facet (e.g. box-plot-chart, whose template wires the facet
 *     itself) → no double-splice; returns input unchanged, the core rewrites it.
 *   - Fail-closed: a facet is bound but the shelf cannot be resolved unambiguously
 *     → THROW (the caller turns this into an apply error), never a corrupt sheet.
 *
 * SHELF ROLE (per the slot's role, inferred structurally): the facet is a
 * categorical dimension that partitions the panes, so it goes on the shelf that
 * already carries the chart's DIMENSION pill (the other shelf carries the
 * measure). This reproduces both facet manifests exactly — trend-line-chart's
 * facet_col (cols hold the truncated-date dimension) and ranking-ordered-bar's
 * facet_row (rows hold the ranked category) — without needing the manifest at
 * apply time, so every apply path (inject-template and build-and-apply-worksheet,
 * which both funnel template XML + field_mapping into rewriteFieldReferences)
 * picks it up uniformly.
 */

/** Template field name of the optional small-multiples facet slot (W27-B). */
const FACET_FIELD = 'Facet';

interface ParsedInstanceValue {
  deriv: string;
  field: string;
  role: string;
}

/**
 * Parse a column-instance mapping VALUE into {deriv, field, role}. Accepts the
 * datasource-qualified form `[ds].[deriv:field:role]` the binder emits as well as
 * the bare `[deriv:field:role]`. Returns null for anything not that shape.
 */
function parseInstanceValue(value: string): ParsedInstanceValue | null {
  const stripped = value.includes('].[') ? value.substring(value.indexOf('].[') + 2) : value;
  const m = stripped.match(/^\[([^:]+):([^:]+):([^:\]]+)\]$/);
  if (!m) return null;
  return { deriv: m[1], field: m[2], role: m[3] };
}

/** Role marker → column-instance `type` attribute (nk→nominal, ok→ordinal, qk→quantitative). */
function typeForRole(role: string): string {
  if (role === 'qk') return 'quantitative';
  if (role === 'ok') return 'ordinal';
  return 'nominal';
}

/** The facet mapping value, from the bare `Facet` key or a `Facet@<deriv>` key. */
function resolveFacetMappingValue(fieldMapping: Record<string, string>): string | null {
  if (fieldMapping[FACET_FIELD] != null) return fieldMapping[FACET_FIELD];
  for (const [k, v] of Object.entries(fieldMapping)) {
    if (k === FACET_FIELD || k.startsWith(`${FACET_FIELD}@`)) return v;
  }
  return null;
}

/** Map base column inner-name → role, scanning `<column …>` decls (never `<column-instance>`). */
function baseColumnRoles(xml: string): Map<string, string> {
  const roles = new Map<string, string>();
  const re = /<column\s([^>]*)>/g; // `<column ` (space) excludes `<column-instance` (hyphen)
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const attrs = m[1];
    const name = attrs.match(/\bname=['"]\[([^\]]+)\]['"]/);
    const role = attrs.match(/\brole=['"]([^'"]+)['"]/);
    if (name && role) roles.set(name[1], role[1]);
  }
  return roles;
}

/** Map column-instance inner-name → base-column inner-name, scanning `<column-instance …>` decls. */
function instanceToBase(xml: string): Map<string, string> {
  const map = new Map<string, string>();
  const re = /<column-instance\s([^>]*)>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const attrs = m[1];
    const name = attrs.match(/\bname=['"]\[([^\]]+)\]['"]/);
    const col = attrs.match(/\bcolumn=['"]\[([^\]]+)\]['"]/);
    if (name && col) map.set(name[1], col[1]);
  }
  return map;
}

/** Field name embedded in a column-instance inner-name (`deriv:field:role`, role-anchored). */
function fieldFromInstanceName(inner: string): string | null {
  const parts = inner.split(':');
  if (parts.length < 3) return null;
  for (let i = parts.length - 1; i >= 1; i--) {
    if (parts[i] === 'nk' || parts[i] === 'ok' || parts[i] === 'qk') {
      return parts[i - 1] || null;
    }
  }
  return null;
}

/** Extract a shelf element's inner text (`<rows>…</rows>` / `<cols>…</cols>`), or null if absent. */
function shelfContent(xml: string, shelf: 'rows' | 'cols'): string | null {
  const m = xml.match(new RegExp(`<${shelf}>([\\s\\S]*?)</${shelf}>`));
  return m ? m[1] : null;
}

/** Does any pill on this shelf resolve to a base column with role='dimension'? */
function shelfBearsDimension(
  content: string,
  instToBase: Map<string, string>,
  roles: Map<string, string>,
): boolean {
  const pillRe = /\]\.\[([^\]]+)\]/g; // capture the instance name from `[ds].[inst]`
  let m: RegExpExecArray | null;
  let sawPill = false;
  while ((m = pillRe.exec(content)) !== null) {
    sawPill = true;
    const inst = m[1];
    const base = instToBase.get(inst) ?? fieldFromInstanceName(inst);
    if (base && roles.get(base) === 'dimension') return true;
  }
  // A shelf holding a raw base ref (no `].[`) is unusual; treat as non-dimension.
  void sawPill;
  return false;
}

/**
 * Splice a bound facet pill onto the trellis shelf of a RAW template, ahead of the
 * existing pill, adding the `[Facet]` column-instance declaration if absent. The
 * caller MUST run the field-reference rewrite next (it maps `[Facet]` → the bound
 * field). Returns the input UNCHANGED when no facet is bound, when the template has
 * no `[Facet]` slot, or when the facet is already on a shelf. Throws when a facet
 * is bound but the target shelf cannot be resolved (fail-closed).
 */
export function spliceBoundFacet(
  templateXml: string,
  fieldMapping: Record<string, string>,
): string {
  const facetValue = resolveFacetMappingValue(fieldMapping);
  if (facetValue == null) return templateXml; // no facet bound → identity

  // The template must actually declare the optional facet slot (`[Facet]` base
  // column). Otherwise the mapping key is not for this template → identity.
  if (!/<column\s[^>]*\bname=['"]\[Facet\]['"]/.test(templateXml)) return templateXml;

  const rows = shelfContent(templateXml, 'rows');
  const cols = shelfContent(templateXml, 'cols');

  // Already-on-shelf (template wires its own facet, e.g. box-plot-chart) → let the
  // core rewrite handle it; splicing again would duplicate the pill.
  if ((rows && /:Facet:/.test(rows)) || (cols && /:Facet:/.test(cols))) {
    return templateXml;
  }

  const parsed = parseInstanceValue(facetValue);
  if (!parsed) {
    throw new Error(
      `facet splice: unparseable facet mapping value '${facetValue}' (expected [ds].[deriv:field:role])`,
    );
  }

  // Structural role inference: the facet joins the shelf carrying the DIMENSION
  // pill (the opposite shelf carries the measure).
  const roles = baseColumnRoles(templateXml);
  const instToBase = instanceToBase(templateXml);
  const rowsDim = rows != null && shelfBearsDimension(rows, instToBase, roles);
  const colsDim = cols != null && shelfBearsDimension(cols, instToBase, roles);

  let shelf: 'rows' | 'cols';
  if (rowsDim && !colsDim) shelf = 'rows';
  else if (colsDim && !rowsDim) shelf = 'cols';
  else {
    // Both or neither shelf bears a resolvable dimension → cannot place the facet
    // deterministically. Fail closed rather than emit a corrupt/ambiguous sheet.
    throw new Error(
      `facet splice: cannot resolve trellis shelf (rowsDim=${rowsDim}, colsDim=${colsDim}); refusing to splice a bound facet`,
    );
  }

  // The intermediate pill is written with the TEMPLATE field name `Facet`; the
  // deriv/role/type come from the bound value so the intermediate is coherent, and
  // the next-stage core rewrite finalizes name + derivation to the bound field.
  const instName = `[${parsed.deriv}:${FACET_FIELD}:${parsed.role}]`;
  const pill = `[{{DATASOURCE}}].${instName}`;

  let out = templateXml.replace(
    new RegExp(`(<${shelf}>)([\\s\\S]*?)(</${shelf}>)`),
    (_whole, open: string, content: string, close: string) => `${open}${pill} / ${content}${close}`,
  );
  if (out === templateXml) {
    throw new Error(`facet splice: <${shelf}> shelf not found for pill insertion`);
  }

  // Add the facet column-instance declaration (after the `[Facet]` base column,
  // keeping base columns grouped) only if the template lacks one. `derivation`
  // is a placeholder — the core rewrite overwrites it with the bound long form.
  if (!/<column-instance[^>]*\bcolumn=['"]\[Facet\]['"]/.test(out)) {
    const decl = `<column-instance column='[Facet]' derivation='None' name='${instName}' pivot='key' type='${typeForRole(
      parsed.role,
    )}' />`;
    const withDecl = out.replace(
      /([ \t]*)(<column\s[^>]*\bname=['"]\[Facet\]['"][^>]*\/>)/,
      (_whole, indent: string, colDecl: string) => `${indent}${colDecl}\n${indent}${decl}`,
    );
    if (withDecl === out) {
      throw new Error(
        'facet splice: [Facet] base column declaration not found for instance insertion',
      );
    }
    out = withDecl;
  }

  return out;
}
