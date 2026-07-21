/**
 * Apply-path DATEPARSE temporal-axis splice (temporal_axis_from_string).
 *
 * A time-series template's temporal slot (trend-line-chart's `order_date`) declares a
 * real DATE base column (`<column datatype='date' name='[Order Date]'>`) with a
 * Month-Trunc CI on the shelf (`[tmn:Order Date:qk]`, derivation 'Month-Trunc') that
 * yields a continuous month axis. When the ONLY temporal-looking field in the dataset
 * is a STRING (e.g. a "2025-08" month column), pointing the axis at that string would
 * ask Tableau to Month-Trunc a string — which it cannot, so the axis renders wrong (or
 * the singer falls back to value-sorted bars, the observed e4 failure).
 *
 * This GLUE step (like waterfallAnchorFilter / facetSplice) runs on the RAW template
 * BEFORE the frozen core rewrite, and ONLY when the binder opted a slot into
 * temporal_axis_from_string and resolved a string source field. Rather than inject a
 * new CI and repoint every reference (which risks duplicate CI names), it does the
 * MINIMAL edit:
 *   1. Rewrites the template's temporal BASE column declaration in place, turning
 *      `<column datatype='date' name='[Order Date]' …/>` into a DATEPARSE CALC column
 *      `<column …><calculation formula="DATEPARSE('yyyy-MM', [month])"/></column>`.
 *   2. Declares the bound string SOURCE column (`[month]`) so the formula resolves.
 * The existing `[tmn:Order Date:qk]` CI and every shelf/format reference stay
 * byte-unchanged — they now truncate a real (parsed) date. The binder MUST skip the
 * temporal slot's field_mapping entry so the core rewrite leaves `[Order Date]` alone.
 *
 * INVARIANTS
 *   - No dateparse axis requested (null spec) → identity: byte-for-byte unchanged.
 *   - Idempotent: the base column is only rewritten if it isn't already a calc.
 *   - Fail-closed: if the temporal base column can't be found to rewrite, THROW rather
 *     than emit a chart whose axis silently truncates a string.
 *
 * CORRECTNESS CAVEAT (why the binder gates this narrowly): DATEPARSE returns NULL
 * silently on a wrong format, and the binder sees only schema, never cell VALUES. The
 * format is inferred from the field name; a mis-inference yields a blank axis. The
 * binder only requests this for a slot that OPTED IN and a date-like field name, and
 * the render MUST be verified live before a template enables the opt-in.
 */

/** Escape a value for use inside a single- or double-quoted XML attribute. */
function escapeXmlAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The signal the binder emits when it accepts a string field for a temporal slot. */
export interface DateparseAxisSpec {
  /** Bare template field name of the temporal slot's base column, e.g. "Order Date". */
  templateField: string;
  /** Bare name of the bound STRING source field in the dataset, e.g. "month". */
  sourceField: string;
  /** DATEPARSE format matching the string values, e.g. "yyyy-MM". */
  format: string;
}

/** Does the template declare a base column named `[bareName]`? */
function hasColumn(xml: string, bareName: string): boolean {
  return new RegExp(`<column\\s[^>]*\\bname=(['"])\\[${escapeRegex(bareName)}\\]\\1`).test(xml);
}

/** Is the named base column already a calc (has a nested <calculation>)? */
function isCalcColumn(xml: string, bareName: string): boolean {
  const m = xml.match(
    new RegExp(
      `<column\\s[^>]*\\bname=(['"])\\[${escapeRegex(bareName)}\\]\\1[^>]*>([\\s\\S]*?)</column>`,
    ),
  );
  return m != null && /<calculation\b/.test(m[2]);
}

/**
 * Convert the template's temporal base column into a DATEPARSE calc reading the bound
 * string field, and declare that source column. Runs on the RAW template, BEFORE the
 * core field-reference rewrite. Returns the input UNCHANGED when `spec` is null.
 */
export function spliceDateparseTemporalAxis(
  templateXml: string,
  spec: DateparseAxisSpec | null,
): string {
  if (spec == null) return templateXml; // no dateparse axis requested → identity

  const { templateField, sourceField, format } = spec;

  // The template must declare the temporal base column we intend to convert.
  if (!hasColumn(templateXml, templateField)) return templateXml;
  // Idempotent: already converted (has a calculation) → nothing to do.
  if (isCalcColumn(templateXml, templateField)) return templateXml;

  // The formula is authored from raw (unescaped) parts, THEN escaped as one unit for
  // the attribute — escaping the parts first would leave the literal `'` delimiters
  // and `[]`/`()` unescaped, corrupting the attribute. DATEPARSE's own quotes become
  // &apos; and Tableau decodes them back at parse time.
  const rawFormula = `DATEPARSE('${format}', [${sourceField}])`;
  const formulaAttr = escapeXmlAttr(rawFormula);

  // 1) Rewrite the (self-closing) date base column into a DATEPARSE calc. The date
  //    datatype is preserved so the Month-Trunc CI keeps operating on a date; a
  //    caption records the origin field for readability.
  const baseColRe = new RegExp(
    `<column(\\s[^>]*\\bname=(['"])\\[${escapeRegex(templateField)}\\]\\2[^>]*?)\\s*/>`,
  );
  const before = templateXml;
  let out = templateXml.replace(baseColRe, (_whole, attrs: string) => {
    // Ensure a caption attribute is present (add one if the template omitted it).
    const withCaption = /\bcaption=/.test(attrs)
      ? attrs
      : `${attrs} caption='${escapeXmlAttr(`${sourceField} (parsed date)`)}'`;
    return `<column${withCaption}><calculation class='tableau' formula='${formulaAttr}' /></column>`;
  });
  if (out === before) {
    throw new Error(
      `dateparse temporal axis: temporal base column [${templateField}] not found in self-closing form to convert to a DATEPARSE calc`,
    );
  }

  // 2) Declare the bound string SOURCE column so the formula's [sourceField] resolves,
  //    unless it is already declared (e.g. it was also bound to another slot).
  if (!hasColumn(out, sourceField)) {
    const sourceDecl = `<column datatype='string' name='[${escapeXmlAttr(
      sourceField,
    )}]' role='dimension' type='nominal' />`;
    // Insert right before the (now-calc) temporal column declaration, keeping base
    // columns grouped. Anchor on the calc column we just wrote.
    const anchorRe = new RegExp(
      `^([ \\t]*)(<column\\s[^>]*\\bname=(['"])\\[${escapeRegex(templateField)}\\]\\3)`,
      'm',
    );
    const withSource = out.replace(
      anchorRe,
      (_whole, indent: string, col: string) => `${indent}${sourceDecl}\n${indent}${col}`,
    );
    if (withSource === out) {
      throw new Error(
        'dateparse temporal axis: could not anchor the source column declaration to the temporal calc column',
      );
    }
    out = withSource;
  }

  return out;
}
