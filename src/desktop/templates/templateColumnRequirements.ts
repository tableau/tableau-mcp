/**
 * Parse a template's declared `<column>` requirements (name/role/datatype/type)
 * out of the template XML. Relocated verbatim from the former
 * `replaceFieldReferences.ts` thin wrapper (removed in W14-CM1) so that wrapper
 * could be deleted once both rewriter consumers moved onto the shared core
 * (`fieldReferenceRewriter.ts`). Pure regex-based reader — no DOM, no fs, no side
 * effects — used by build-and-apply-worksheet to line template slots up against
 * provided fields.
 */
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
