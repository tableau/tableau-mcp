import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import * as xpath from 'xpath';

// DOM nodeType constants — `Node` is not a global in the Node.js/desktop
// runtime, so reference the numeric values directly (matches the source repo).
const TEXT_NODE = 3;
const ATTRIBUTE_NODE = 2;

type FieldInfo = { name: string; derivation: string; role: string };

const DERIVATION_MAP: Record<string, string> = {
  sum: 'Sum',
  avg: 'Avg',
  cnt: 'Count',
  cntd: 'CountD',
  min: 'Min',
  max: 'Max',
  usr: 'User',
  none: 'None',
  yr: 'Year',
  qr: 'Quarter',
  mn: 'Month',
  wk: 'Week',
  dy: 'Day',
  hr: 'Hour',
  mi: 'Minute',
  sc: 'Second',
};

function buildFieldInfoMap(fieldMapping: Record<string, string>): Record<string, FieldInfo> {
  const map: Record<string, FieldInfo> = {};
  for (const [templateFieldName, columnInstance] of Object.entries(fieldMapping)) {
    const stripped = columnInstance.includes('].[')
      ? columnInstance.substring(columnInstance.indexOf('].[') + 2)
      : columnInstance;
    const match = stripped.match(/\[([^:]+):([^:]+):([^\]]+)\]/);
    if (!match) continue;
    const [, derivShort, actualFieldName, role] = match;
    map[templateFieldName] = {
      name: actualFieldName,
      derivation: DERIVATION_MAP[derivShort.toLowerCase()] || derivShort,
      role,
    };
  }
  return map;
}

function selectElements(xp: string, doc: Document): Element[] {
  return xpath.select(xp, doc as unknown as Node) as Element[];
}

function selectTexts(xp: string, doc: Document): Text[] {
  return xpath.select(xp, doc as unknown as Node) as Text[];
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function replaceFieldReferences(
  templateXml: string,
  fieldMapping: Record<string, string>,
  datasourceName: string,
  fieldMetadata?: Record<string, { datatype: string; type: string }>,
): string {
  const parser = new DOMParser({
    errorHandler: (_level, _msg) => {},
  });
  const doc = parser.parseFromString(templateXml, 'text/xml') as unknown as Document;
  const fieldInfoMap = buildFieldInfoMap(fieldMapping);

  const baseColumns = selectElements('//column[@name]', doc);
  for (const col of baseColumns) {
    const nameValue = col.getAttribute('name');
    if (!nameValue) continue;
    const m = nameValue.match(/^\[([^\]:]+)\]$/);
    if (m && fieldInfoMap[m[1]]) {
      const fi = fieldInfoMap[m[1]];
      col.setAttribute('name', `[${fi.name}]`);
      const meta = fieldMetadata?.[m[1]];
      if (meta) {
        if (col.hasAttribute('datatype')) col.setAttribute('datatype', meta.datatype);
        if (col.hasAttribute('type')) col.setAttribute('type', meta.type);
      }
    }
  }

  const colInstances = selectElements('//column-instance[@column]', doc);
  for (const ci of colInstances) {
    const colVal = ci.getAttribute('column');
    if (!colVal) continue;
    const m = colVal.match(/^\[([^\]:]+)\]$/);
    if (m && fieldInfoMap[m[1]]) ci.setAttribute('column', `[${fieldInfoMap[m[1]].name}]`);
  }

  for (const ci of colInstances) {
    const nameVal = ci.getAttribute('name');
    if (!nameVal) continue;
    const m = nameVal.match(/^\[([^:]+):([^:]+):([^\]]+)\]$/);
    if (m && fieldInfoMap[m[2]]) {
      const fi = fieldInfoMap[m[2]];
      ci.setAttribute('name', `[${fi.derivation}:${fi.name}:${fi.role}]`);
    }
  }

  const allText = selectTexts('//text()', doc);
  for (const textNode of allText) {
    let text = textNode.data;
    let modified = false;
    for (const [templateFieldName, fi] of Object.entries(fieldInfoMap)) {
      const regex = new RegExp(
        `\\[\\{\\{DATASOURCE\\}\\}\\]\\.\\[([^:]+):${escapeRegex(templateFieldName)}:([^\\]]+)\\]`,
        'g',
      );
      // Function replacer: the field/datasource values are inserted literally,
      // so `$`-sequences in names (e.g. "Net $1") are not treated as backrefs.
      const newText = text.replace(
        regex,
        () => `[${datasourceName}].[${fi.derivation}:${fi.name}:${fi.role}]`,
      );
      if (newText !== text) {
        text = newText;
        modified = true;
      }
    }
    if (modified) textNode.data = text;
  }

  const allElements = selectElements('//*[@*]', doc);
  for (const elem of allElements) {
    const attrs = Array.from(elem.attributes) as Attr[];
    for (const attr of attrs) {
      let value = attr.value;
      for (const [templateFieldName, fi] of Object.entries(fieldInfoMap)) {
        const regex = new RegExp(
          `\\[\\{\\{DATASOURCE\\}\\}\\]\\.\\[([^:]+):${escapeRegex(templateFieldName)}:([^\\]]+)\\]`,
          'g',
        );
        value = value.replace(
          regex,
          () => `[${datasourceName}].[${fi.derivation}:${fi.name}:${fi.role}]`,
        );
      }
      attr.value = value;
    }
  }

  // Replace remaining {{DATASOURCE}} in all text and attribute nodes
  const allNodes = xpath.select('//text() | //*/@*', doc as unknown as Node) as Node[];
  for (const node of allNodes) {
    if (node.nodeType === TEXT_NODE) {
      const t = node as Text;
      const newText = t.data.replace(/\{\{DATASOURCE\}\}/g, () => datasourceName);
      if (newText !== t.data) t.data = newText;
    } else if (node.nodeType === ATTRIBUTE_NODE) {
      const a = node as Attr;
      const newVal = a.value.replace(/\{\{DATASOURCE\}\}/g, () => datasourceName);
      if (newVal !== a.value) a.value = newVal;
    }
  }

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
