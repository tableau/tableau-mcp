// Desktop opens a "Where is the data source" dialog for a dashboard <datasources> entry that differs from the workbook's (a missing caption is a caption; Parameters has none).
import { escapeXml } from '../binder/escape.js';
import { normalizeArray, parseXML } from '../metadata/parser.js';

type XmlRecord = Record<string, any>;

export interface DatasourceEntry {
  name: string;
  caption?: string;
}

export interface DatasourceMismatch {
  sent: DatasourceEntry;
  workbook?: DatasourceEntry;
}

function isRecord(value: unknown): value is XmlRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function entries(container: unknown): DatasourceEntry[] {
  if (!isRecord(container)) return [];
  return normalizeArray(container.datasource)
    .filter(isRecord)
    .map((element) => {
      const caption = element['@_caption'];
      return {
        name: String(element['@_name'] ?? ''),
        ...(typeof caption === 'string' ? { caption } : {}),
      };
    });
}

function fragmentEntries(fragmentXml: string): DatasourceEntry[] {
  const dashboard = normalizeArray(parseXML(fragmentXml).dashboard as unknown)[0];
  if (!isRecord(dashboard)) return [];
  return normalizeArray(dashboard.datasources).flatMap(entries);
}

function workbookEntries(workbookXml: string): DatasourceEntry[] {
  const workbook = parseXML(workbookXml).workbook as unknown;
  return isRecord(workbook) ? entries(workbook.datasources) : [];
}

export function hasDashboardDatasources(fragmentXml: string): boolean {
  try {
    const dashboard = normalizeArray(parseXML(fragmentXml).dashboard as unknown)[0];
    return isRecord(dashboard) ? dashboard.datasources !== undefined : false;
  } catch {
    // The validation funnel reports malformed fragments before dispatch.
    return false;
  }
}

export function dashboardDatasourceMismatches(
  fragmentXml: string,
  workbookXml: string,
): DatasourceMismatch[] {
  return mismatchesAgainst(fragmentEntries(fragmentXml), workbookEntries(workbookXml));
}

function mismatchesAgainst(
  sent: DatasourceEntry[],
  known: DatasourceEntry[],
): DatasourceMismatch[] {
  const mismatches: DatasourceMismatch[] = [];
  for (const entry of sent) {
    const workbook = known.find((candidate) => candidate.name === entry.name);
    if (!workbook || workbook.caption !== entry.caption) mismatches.push({ sent: entry, workbook });
  }
  return mismatches;
}

function element(entry: DatasourceEntry): string {
  const caption = entry.caption === undefined ? '' : `caption='${escapeXml(entry.caption)}' `;
  return `<datasource ${caption}name='${escapeXml(entry.name)}' />`;
}

export function dashboardDatasourceRefusal(
  fragmentXml: string,
  workbookXml: string,
): string | undefined {
  const sent = fragmentEntries(fragmentXml);
  if (sent.length === 0) return undefined;
  const known = workbookEntries(workbookXml);
  const mismatches = mismatchesAgainst(sent, known);
  if (mismatches.length === 0) return undefined;
  const problems: string[] = [];
  const fixes: string[] = [];
  const copies: string[] = [];
  for (const { sent: entry, workbook } of mismatches) {
    const lead = `The dashboard's <datasources> entry for "${entry.name}"`;
    if (!workbook) {
      problems.push(`${lead} is not a datasource in this workbook.`);
      continue;
    }
    const had = entry.caption === undefined ? 'has no caption' : `has caption "${entry.caption}"`;
    const want =
      workbook.caption === undefined
        ? "but the workbook's entry has no caption"
        : `but the workbook's caption is "${workbook.caption}"`;
    problems.push(`${lead} ${had}, ${want}.`);
    copies.push(element(workbook));
  }
  if (copies.length > 0) {
    fixes.push(
      `use ${copies.join(' and ')}, the workbook's own ${copies.length > 1 ? 'entries' : 'entry'}`,
    );
  }
  if (mismatches.some(({ workbook }) => !workbook)) {
    fixes.push(
      known.length > 0
        ? `remove the unknown entry or copy one of the workbook's own entries (${known.map(element).join(', ')})`
        : 'remove the unknown entry (the workbook has no datasources)',
    );
  }
  return (
    `${problems.join(' ')} Desktop opens a "Where is the data source" dialog for an entry that doesn't match. ` +
    `FIX: ${fixes.join('; ')}, or leave the <datasources> block out and Tableau adds it. ` +
    'No changes were sent to Tableau.'
  );
}
