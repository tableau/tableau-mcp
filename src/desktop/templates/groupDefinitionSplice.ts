/**
 * Apply-path GROUP-definition splice — make a BOUND Tableau GROUP (a `categorical-bin`
 * calculation, e.g. `Product Name (group)`) SURVIVE Tableau's load validation.
 *
 * A Tableau group is a `<column>` whose child is
 * `<calculation class='categorical-bin' column='[base]'>…<bin><value>…</value></bin>…`.
 * The field-reference rewriter renames a template's HOLLOW off-shelf `<column>` (e.g.
 * `[Facet]`) to the bound field name, but it has no group BODY to attach — the donor
 * template never carried one. The emitted worksheet then declares
 * `<column name='[Product Name (group)]'></column>` with no `<calculation>` child, and
 * Tableau strips the field on load: "There is no field named 'Product Name (group)'".
 *
 * This GLUE step closes that gap WITHOUT touching the byte-locked rewriter core. It runs
 * AFTER the core rewrite (so the column already carries its final bound name) and, for
 * every bound field that the TARGET workbook's datasource dictionary defines as a group,
 * materializes the group's authoritative definition into the sheet's own
 * `<datasource-dependencies>`:
 *
 *   1. Replaces the hollow renamed `<column>` with the dictionary's full group `<column>`
 *      (the `categorical-bin` `<calculation>` body rides inline).
 *   2. Adds the base `<column>` the group's calc references (e.g. `[Product Name]`), which
 *      the worksheet must also declare — verified against a Desktop-saved reference
 *      (`viz-with-group`), whose worksheet `<datasource-dependencies>` carries BOTH the
 *      group column (with body) and its base column.
 *
 * The definition is read from the TARGET workbook — the only authority on what its own
 * datasources define — exactly like `withTargetSemanticRoles` in injectTemplateCore reads
 * the target for a bound field's geo role. A field the binder chose always exists in that
 * workbook's schema (the schema is summarized from it), so the definition is always
 * recoverable.
 *
 * INVARIANTS
 *   - No bound field is a group → returns the input string UNCHANGED (identity).
 *   - A bound field IS a group but the sheet has no hollow column to fill (already carries
 *     a `<calculation>`, or the name is absent) → that group is skipped, others still run.
 *   - Read-only w.r.t. the target workbook: only the injected sheet string is modified.
 */
import { normalizeArray, parseXML, serializeXML } from '../metadata/parser.js';

/**
 * Calculation classes that define a DERIVED GROUPING whose body must travel inline in a
 * worksheet's dependencies or Tableau strips the field. Scoped to `categorical-bin`
 * (a Tableau group) — the confirmed failing class. Numeric `bin`/`set` derivations share
 * the shape and can be added here if they exhibit the same strip.
 */
const GROUP_CALC_CLASSES = new Set(['categorical-bin']);

interface GroupDefinition {
  /** Bracketed group name, e.g. "[Product Name (group)]". */
  groupName: string;
  /** Serialized `<column>…</column>` carrying the categorical-bin body, from the dictionary. */
  columnXml: string;
  /** Bracketed base column the calc references, e.g. "[Product Name]" (may be undefined). */
  baseName?: string;
  /** Serialized base `<column …/>` definition, when recoverable from the dictionary. */
  baseColumnXml?: string;
}

/** Strip surrounding brackets: "[Product Name (group)]" -> "Product Name (group)". */
function bareName(name: string): string {
  return name.replace(/^\[|\]$/g, '');
}

/** Escape a string for safe use as a literal inside a RegExp. */
function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Bare local field name out of a field_mapping VALUE (`[ds].[deriv:Field Name:suffix]`
 * or the unqualified `[deriv:Field:suffix]`). Values are pre-escaped for XML attributes,
 * so entity-decode before matching a dictionary name carrying `&`/`'`/`"`.
 */
function mappedFieldName(columnInstance: string): string | null {
  const stripped = columnInstance.includes('].[')
    ? columnInstance.substring(columnInstance.indexOf('].[') + 2)
    : columnInstance;
  const match = stripped.match(/\[([^:]+):(.+):([^:\]]+)\]$/);
  if (!match) return null;
  return match[2]
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/** Serialize a single parsed element node back to an XML string, e.g. `<column …>…</column>`. */
function serializeElement(tag: string, node: unknown): string {
  return serializeXML({ [tag]: node });
}

/**
 * Every group the target workbook's datasource dictionaries define, keyed by BARE group
 * name. A group is a top-level `<column>` whose `<calculation>` child is a
 * {@link GROUP_CALC_CLASSES} class. Also carries the base column the calc references, so
 * the sheet can declare it alongside the group.
 */
function collectGroupDefinitions(workbookXml: string): Map<string, GroupDefinition> {
  const groups = new Map<string, GroupDefinition>();
  let workbook;
  try {
    workbook = parseXML(workbookXml);
  } catch {
    return groups; // a workbook we cannot parse defines no groups we can trust
  }

  const datasources = normalizeArray(workbook.workbook?.datasources?.datasource);
  for (const datasource of datasources) {
    const dsName = (datasource as Record<string, unknown>)['@_name'];
    if (dsName === 'Parameters') continue;

    const columns = normalizeArray((datasource as Record<string, any>).column);
    // Index every named top-level column so a group's base column can be recovered.
    const byName = new Map<string, unknown>();
    for (const col of columns) {
      const name = (col as Record<string, unknown>)['@_name'];
      if (typeof name === 'string') byName.set(name, col);
    }

    for (const col of columns) {
      const record = col as Record<string, any>;
      const name = record['@_name'];
      const calc = record['calculation'];
      if (typeof name !== 'string' || !calc || Array.isArray(calc)) continue;
      const calcClass = (calc as Record<string, unknown>)['@_class'];
      if (typeof calcClass !== 'string' || !GROUP_CALC_CLASSES.has(calcClass)) continue;

      const baseNameRaw = (calc as Record<string, unknown>)['@_column'];
      const baseName = typeof baseNameRaw === 'string' ? baseNameRaw : undefined;
      const baseNode = baseName ? byName.get(baseName) : undefined;

      groups.set(bareName(name), {
        groupName: name,
        columnXml: serializeElement('column', record),
        baseName,
        baseColumnXml: baseNode ? serializeElement('column', baseNode) : undefined,
      });
    }
  }
  return groups;
}

/** True when the sheet already declares a `<column>` (not `<column-instance>`) with this bracketed name. */
function hasColumnNamed(xml: string, bracketedName: string): boolean {
  const esc = escapeRegex(bareName(bracketedName));
  return new RegExp(`<column\\s[^>]*\\bname=(["'])\\[${esc}\\]\\1`).test(xml);
}

/**
 * Replace the hollow renamed group `<column>` with its full dictionary definition and,
 * when absent, declare the base column the calc references immediately before it. Only a
 * HOLLOW element (self-closing or empty `<column…></column>`) is replaced — a column that
 * already carries a body is left untouched.
 */
function materializeGroup(xml: string, def: GroupDefinition): string {
  const esc = escapeRegex(bareName(def.groupName));
  // Match ONLY the base `<column ` element (the trailing space excludes `<column-instance`)
  // with this name that is hollow: self-closing `/>` or an empty `></column>`.
  const hollow = new RegExp(
    `<column\\s[^>]*\\bname=(["'])\\[${esc}\\]\\1[^>]*?(?:/>|>\\s*</column>)`,
  );
  const match = hollow.exec(xml);
  if (!match) return xml; // no hollow column to fill (already bodied, or name absent)

  const needsBase = !!def.baseName && !hasColumnNamed(xml, def.baseName);
  const baseXml = needsBase ? def.baseColumnXml : undefined;
  const replacement = baseXml ? `${baseXml}\n${def.columnXml}` : def.columnXml;

  // Replacer FUNCTION, not a string: group member values can contain `$`, which a string
  // replacement would treat as a `$&`/`$1` back-reference.
  return xml.slice(0, match.index) + replacement + xml.slice(match.index + match[0].length);
}

/**
 * Materialize every bound GROUP's definition into the injected sheet. Runs after the field
 * rewrite; identity when no bound field is a group in the target workbook.
 *
 * @param processedXml - The injected template sheet AFTER `rewriteFieldReferences` (columns
 *   carry their final bound names).
 * @param fieldMapping - Template field → column-instance ref map (values are `[ds].[…]`).
 * @param workbookXml - The TARGET workbook — the authority on its own group definitions.
 */
export function spliceBoundGroupDefinitions(
  processedXml: string,
  fieldMapping: Record<string, string> | undefined,
  workbookXml: string,
): string {
  if (!fieldMapping || Object.keys(fieldMapping).length === 0) return processedXml;
  const groups = collectGroupDefinitions(workbookXml);
  if (groups.size === 0) return processedXml;

  let out = processedXml;
  const done = new Set<string>();
  for (const value of Object.values(fieldMapping)) {
    const bare = mappedFieldName(value);
    if (!bare || done.has(bare)) continue;
    const def = groups.get(bare);
    if (!def) continue;
    done.add(bare);
    out = materializeGroup(out, def);
  }
  return out;
}
