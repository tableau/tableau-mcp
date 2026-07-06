import { rewriteFieldReferences } from './fieldReferenceRewriter.js';

/**
 * THIN WRAPPER over the shared DOM-structural rewriter
 * ({@link rewriteFieldReferences} in `fieldReferenceRewriter.ts`). Preserves the
 * historical `replaceFieldReferences` signature so existing consumers keep
 * compiling; the substitution body and the inline `DERIVATION_MAP` that used to
 * live here now belong to the pure, repo-agnostic core.
 *
 * Behavior note: the core takes RAW (unescaped) `fieldMapping` values and
 * `datasourceName` and escapes exclusively via DOM serialization — callers must
 * NOT pre-escape. Per-apply calc namespacing is left OFF here (this wrapper
 * never namespaced), matching prior behavior; callers wanting it use the core
 * directly with an explicit nonce.
 *
 * @param templateXml - Template XML with `{{DATASOURCE}}` placeholders and template field names.
 * @param fieldMapping - Map of template field names to actual column-instance refs (RAW values).
 * @param datasourceName - Actual (RAW) datasource name to substitute for `{{DATASOURCE}}`.
 * @param fieldMetadata - Optional datatype/type overrides for renamed base `<column>` definitions.
 * @returns Modified XML with datasource and field references replaced.
 */
export function replaceFieldReferences(
  templateXml: string,
  fieldMapping: Record<string, string>,
  datasourceName: string,
  fieldMetadata?: Record<string, { datatype: string; type: string }>,
): string {
  return rewriteFieldReferences(templateXml, fieldMapping, datasourceName, fieldMetadata);
}

export function getTemplateColumnRequirements(
  templateXml: string,
): { name: string; role: string; datatype: string; type: string }[] {
  const columns: { name: string; role: string; datatype: string; type: string }[] = [];
  const columnRegex = /<column\s+([^>]*)>/g;
  let match;
  while ((match = columnRegex.exec(templateXml)) !== null) {
    const attrs = match[1];
    const nameMatch = attrs.match(/name=['"]?\[([^\]']+)\]['"]?/);
    const roleMatch = attrs.match(/role=['"]([^'"]+)['"]/);
    const datatypeMatch = attrs.match(/datatype=['"]([^'"]+)['"]/);
    const typeMatch = attrs.match(/type=['"]([^'"]+)['"]/);
    if (nameMatch && roleMatch && datatypeMatch && typeMatch) {
      columns.push({
        name: nameMatch[1],
        role: roleMatch[1],
        datatype: datatypeMatch[1],
        type: typeMatch[1],
      });
    }
  }
  return columns;
}
