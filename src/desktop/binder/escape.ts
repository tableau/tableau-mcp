// src/binder/escape.ts
//
// XML-attribute escaping for the bind OUTPUT pipeline (Lane M10, Finding 1).
//
// `bindTemplate()` returns `title` (proposal/caller-controlled), the
// `template_parameters.DATASOURCE`, and every `field_mapping` VALUE (both
// workbook-controlled), and `APPLY_INSTRUCTION` tells the consuming agent to substitute
// them VERBATIM into single-quoted template XML attributes (`name='{{TITLE}}'`,
// `datasource name='{{DATASOURCE}}'`). Unescaped, a workbook datasource named
// `Evil'/><datasource name='pwn` or a hostile title breaks out of the attribute and
// injects XML structure at the exact seam this pipeline exists to feed.
//
// The five XML metacharacters are escaped EXACTLY ONCE, at the point the returned
// payload is produced (validate.ts gate 7 for datasource + field_mapping values,
// validateAndBuild for the title) — so consumers substitute the value as-is and MUST
// NOT escape again. Tableau field-reference brackets `[ ]` are NOT XML metacharacters
// and are deliberately left intact, so a clean ref like
// `[federated.0ztvudt1oegxmm1fw0jci1udekag].[sum:Sales:qk]` round-trips byte-identical.

/**
 * Escape the five XML metacharacters (`& < > " '`) for verbatim substitution into a
 * single- or double-quoted XML attribute value. `&` is replaced FIRST so the entity
 * ampersands introduced by the later replacements are not double-escaped. A string
 * containing none of these characters is returned byte-identical.
 */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
