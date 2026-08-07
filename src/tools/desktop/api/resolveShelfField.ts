import { parseCanonicalColumnRef } from '../../../desktop/metadata/field-resolver.js';
import { listFields } from '../../../desktop/metadata/index.js';

/**
 * Resolve a user-supplied field name to the exact on-shelf column-instance token a worksheet's
 * `<cols>`/`<rows>`/encodings carry (e.g. `[Sample - Superstore].[none:Segment:nk]`). The sort
 * route matches only that verbatim token — a base column name like `[ds].[Segment]` is silently
 * ignored — so the tool resolves here rather than making the agent reverse-engineer it.
 *
 * Accepts either the on-shelf token itself (returned verbatim) or a plain field name/caption
 * matched case-insensitively against each on-shelf pill's local field name.
 */
export function resolveShelfField(
  worksheetXml: string,
  requested: string,
): { ok: true; column: string } | { ok: false; onShelf: Array<string> } {
  const shelfColumns = listFields(worksheetXml).map((field) => field.column);
  const onShelf = dedupe(shelfColumns);

  const trimmed = requested.trim();
  if (onShelf.includes(trimmed)) {
    return { ok: true, column: trimmed };
  }

  const wanted = stripBrackets(trimmed).toLowerCase();
  for (const column of onShelf) {
    const parsed = parseCanonicalColumnRef(column);
    const localName = parsed?.localFieldName;
    if (localName !== undefined && localName.toLowerCase() === wanted) {
      return { ok: true, column };
    }
  }

  return { ok: false, onShelf };
}

function dedupe(values: Array<string>): Array<string> {
  return Array.from(new Set(values));
}

function stripBrackets(value: string): string {
  return value.replace(/^\[/, '').replace(/\]$/, '');
}
