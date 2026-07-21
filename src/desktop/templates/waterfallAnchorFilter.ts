const ANCHOR_FIELD = 'Anchor Category';
const ANCHOR_MEMBERS = ['subtotal', 'total'] as const;

interface ParsedInstanceValue {
  datasource?: string;
  deriv: string;
  field: string;
  role: string;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function escapeXmlAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function typeForRole(role: string): string {
  if (role === 'qk') return 'quantitative';
  if (role === 'ok') return 'ordinal';
  return 'nominal';
}

function parseInstanceValue(value: string): ParsedInstanceValue | null {
  const qualified = value.match(/^\[([^\]]+)\]\.\[([^:]+):([^:]+):([^\]]+)\]$/);
  if (qualified) {
    return {
      datasource: qualified[1],
      deriv: qualified[2],
      field: qualified[3],
      role: qualified[4],
    };
  }

  const bare = value.match(/^\[([^:]+):([^:]+):([^\]]+)\]$/);
  if (bare) return { deriv: bare[1], field: bare[2], role: bare[3] };

  return null;
}

function resolveAnchorMappingValue(fieldMapping: Record<string, string>): string | null {
  if (fieldMapping[ANCHOR_FIELD] != null) return fieldMapping[ANCHOR_FIELD];
  for (const [key, value] of Object.entries(fieldMapping)) {
    if (key === ANCHOR_FIELD || key.startsWith(`${ANCHOR_FIELD}@`)) return value;
  }
  return null;
}

function datasourceName(xml: string): string | null {
  const m = xml.match(/<datasource-dependencies\b[^>]*\bdatasource=(['"])(.*?)\1/);
  return m ? m[2] : null;
}

function isWaterfallTemplate(xml: string): boolean {
  return /<mark\b[^>]*\bclass=(['"])GanttBar\1/.test(xml) && /\[cum:sum:[^\]]+:qk\]/.test(xml);
}

function ensureUserNamespace(xml: string): string {
  if (/\sxmlns:user=/.test(xml)) return xml;
  return xml.replace(
    /<([A-Za-z0-9:_-]+)(\s|>)/,
    "<$1 xmlns:user='http://www.tableausoftware.com/xml/user'$2",
  );
}

function hasColumn(xml: string, field: string): boolean {
  return new RegExp(`<column\\s[^>]*\\bname=(['"])\\[${escapeRegex(field)}\\]\\1`).test(xml);
}

function hasColumnInstance(xml: string, instanceName: string): boolean {
  return new RegExp(`<column-instance\\s[^>]*\\bname=(['"])${escapeRegex(instanceName)}\\1`).test(
    xml,
  );
}

function insertDependencyDeclarations(xml: string, parsed: ParsedInstanceValue): string {
  const instanceName = `[${parsed.deriv}:${parsed.field}:${parsed.role}]`;
  const declarations: string[] = [];

  if (!hasColumn(xml, parsed.field)) {
    declarations.push(
      `<column datatype='string' name='[${escapeXmlAttr(parsed.field)}]' role='dimension' type='nominal' />`,
    );
  }

  if (!hasColumnInstance(xml, instanceName)) {
    declarations.push(
      `<column-instance column='[${escapeXmlAttr(parsed.field)}]' derivation='None' name='[${escapeXmlAttr(
        `${parsed.deriv}:${parsed.field}:${parsed.role}`,
      )}]' pivot='key' type='${typeForRole(parsed.role)}' />`,
    );
  }

  if (declarations.length === 0) return xml;

  return xml.replace(
    /^([ \t]*)(<column-instance\b)/m,
    (_whole, indent: string, columnInstance: string) =>
      `${indent}${declarations.join(`\n${indent}`)}\n${indent}${columnInstance}`,
  );
}

/**
 * Splice the optional P&L waterfall anchor category filter after field rewriting.
 *
 * The anchor slot is virtual: unbound waterfalls must keep the stamped template bytes
 * unchanged. When bound, the already-rewritten mapping tells us the real categorical
 * column to declare and filter.
 */
export function spliceWaterfallAnchorFilter(
  templateXml: string,
  fieldMapping: Record<string, string>,
): string {
  const anchorValue = resolveAnchorMappingValue(fieldMapping);
  if (anchorValue == null) return templateXml;
  if (!isWaterfallTemplate(templateXml)) return templateXml;

  const parsed = parseInstanceValue(anchorValue);
  if (!parsed) return templateXml;

  const datasource = parsed.datasource ?? datasourceName(templateXml);
  if (!datasource) return templateXml;

  const instanceName = `[${parsed.deriv}:${parsed.field}:${parsed.role}]`;
  const qualifiedColumn = `[${datasource}].${instanceName}`;
  if (templateXml.includes(`<filter class="categorical" column="${qualifiedColumn}"`)) {
    return templateXml;
  }
  if (templateXml.includes(`<filter class='categorical' column='${qualifiedColumn}'`)) {
    return templateXml;
  }

  const withDeclarations = insertDependencyDeclarations(templateXml, parsed);
  if (withDeclarations === templateXml && !hasColumn(withDeclarations, parsed.field)) {
    return templateXml;
  }

  const filter = [
    `<filter class='categorical' column='${escapeXmlAttr(qualifiedColumn)}'>`,
    "  <groupfilter function='except' user:ui-domain='database' user:ui-enumeration='inclusive' user:ui-marker='enumerate'>",
    `    <groupfilter function='level-members' level='${escapeXmlAttr(instanceName)}' />`,
    "    <groupfilter function='union'>",
    ...ANCHOR_MEMBERS.map(
      (member) =>
        `      <groupfilter function='member' level='${escapeXmlAttr(instanceName)}' member='&quot;${member}&quot;' />`,
    ),
    '    </groupfilter>',
    '  </groupfilter>',
    '</filter>',
  ].join('\n          ');

  return ensureUserNamespace(withDeclarations).replace(
    /^([ \t]*)<\/datasource-dependencies>/m,
    (_whole, indent: string) => `${indent}</datasource-dependencies>\n${indent}${filter}`,
  );
}
