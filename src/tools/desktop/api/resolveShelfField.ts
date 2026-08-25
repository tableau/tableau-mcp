import { parseCanonicalColumnRef } from '../../../desktop/metadata/field-resolver.js';
import { listFields, normalizeArray, parseXML } from '../../../desktop/metadata/index.js';
import { ParsedWorksheet } from '../../../desktop/metadata/types.js';

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
):
  | { ok: true; column: string; type: string | undefined }
  | { ok: false; reason: 'not_found'; onShelf: Array<string> }
  | { ok: false; reason: 'ambiguous'; candidates: Array<string> } {
  const shelfColumns = listFields(worksheetXml).map((field) => field.column);
  const onShelf = dedupe(shelfColumns);
  const metadata = columnInstanceMetadata(worksheetXml);

  const trimmed = requested.trim();
  if (onShelf.includes(trimmed)) {
    return { ok: true, column: trimmed, type: metadata.get(trimmed)?.type };
  }

  const wanted = stripBrackets(trimmed).toLowerCase();
  const candidates: Array<string> = [];
  for (const column of onShelf) {
    const declaration = metadata.get(column);
    const localNames = declaration?.localNames ?? [parseCanonicalColumnRef(column)?.localFieldName];
    if (localNames.some((localName) => localName?.toLowerCase() === wanted)) {
      candidates.push(column);
    }
  }
  if (candidates.length === 1) {
    const column = candidates[0];
    return { ok: true, column, type: metadata.get(column)?.type };
  }
  if (candidates.length > 1) {
    return { ok: false, reason: 'ambiguous', candidates };
  }

  return { ok: false, reason: 'not_found', onShelf };
}

function columnInstanceMetadata(
  worksheetXml: string,
): Map<string, { localNames: string[]; type: string | undefined }> {
  const parsed = parseXML(worksheetXml);
  const worksheet =
    normalizeArray(parsed.worksheet as ParsedWorksheet | undefined)[0] ??
    normalizeArray(parsed.workbook?.worksheets?.worksheet)[0] ??
    normalizeArray(parsed.workbook?.worksheet as ParsedWorksheet | undefined)[0];
  const metadata = new Map<string, { localNames: string[]; type: string | undefined }>();
  for (const dependency of normalizeArray(worksheet?.table?.view?.['datasource-dependencies'])) {
    const datasource = dependency['@_datasource'];
    if (!datasource) continue;
    const columns = new Map(
      normalizeArray(dependency.column).map((column) => [column['@_name'], column]),
    );
    for (const instance of normalizeArray(dependency['column-instance'])) {
      const name = instance['@_name'];
      if (!name) continue;
      const baseColumn = columns.get(instance['@_column']);
      metadata.set(`[${datasource}].${name}`, {
        localNames: dedupe(
          [instance['@_column'], baseColumn?.['@_name'], baseColumn?.['@_caption']]
            .filter((value): value is string => value !== undefined)
            .map(stripBrackets),
        ),
        type: instance['@_type'],
      });
    }
  }
  return metadata;
}

function dedupe(values: Array<string>): Array<string> {
  return Array.from(new Set(values));
}

function stripBrackets(value: string): string {
  return value.replace(/^\[/, '').replace(/\]$/, '');
}
