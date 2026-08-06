import {
  normalizeArray,
  parseXMLPreservingNumericEntities,
  serializeXMLPreservingNumericEntities,
} from '../metadata/parser.js';

const GROUP_CALC_CLASSES = new Set(['categorical-bin']);

interface GroupDefinition {
  groupName: string;
  columnXml: string;
  baseName?: string;
  baseColumnXml?: string;
}

function bareName(name: string): string {
  return name.replace(/^\[|\]$/g, '');
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

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

function serializeElement(tag: string, node: unknown): string {
  return serializeXMLPreservingNumericEntities({ [tag]: node });
}

function collectGroupDefinitions(workbookXml: string): Map<string, GroupDefinition> {
  const groups = new Map<string, GroupDefinition>();
  let workbook;
  try {
    workbook = parseXMLPreservingNumericEntities(workbookXml);
  } catch {
    return groups; // a workbook we cannot parse defines no groups we can trust
  }

  const datasources = normalizeArray(workbook.workbook?.datasources?.datasource);
  for (const datasource of datasources) {
    const dsName = (datasource as Record<string, unknown>)['@_name'];
    if (dsName === 'Parameters') continue;

    const columns = normalizeArray((datasource as Record<string, any>).column);
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

function hasColumnNamed(xml: string, bracketedName: string): boolean {
  const esc = escapeRegex(bareName(bracketedName));
  return new RegExp(`<column\\s[^>]*\\bname=(["'])\\[${esc}\\]\\1`).test(xml);
}

function materializeGroup(xml: string, def: GroupDefinition): string {
  const esc = escapeRegex(bareName(def.groupName));
  const hollow = new RegExp(
    `<column\\s[^>]*\\bname=(["'])\\[${esc}\\]\\1[^>]*?(?:/>|>\\s*</column>)`,
  );
  const match = hollow.exec(xml);
  if (!match) return xml;

  const needsBase = !!def.baseName && !hasColumnNamed(xml, def.baseName);
  const baseXml = needsBase ? def.baseColumnXml : undefined;
  const replacement = baseXml ? `${baseXml}\n${def.columnXml}` : def.columnXml;

  return xml.slice(0, match.index) + replacement + xml.slice(match.index + match[0].length);
}

// Tableau drops bound groups unless their target-workbook definitions travel with the sheet.
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
