/**
 * Post-apply worksheet readback verification.
 *
 * Tableau Desktop can accept a worksheet apply and then silently strip nodes it
 * cannot persist. This verifier compares only the intent-bearing worksheet
 * structures that must survive for the rendered chart to match the authored
 * XML, while tolerating readback-only formatting/style noise.
 */
import { normalizeArray, parseXML } from '../metadata/parser.js';

export type ReadbackFindingKind = 'encoding' | 'shelf' | 'mark' | 'filter' | 'sort';
export type ReadbackFindingSeverity = 'error' | 'warning';

export interface ReadbackFinding {
  kind: ReadbackFindingKind;
  node: string;
  column?: string;
  intended: string;
  readback: 'missing' | 'changed';
  severity: ReadbackFindingSeverity;
}

export type ReadbackVerificationStatus = 'passed' | 'warning' | 'failed' | 'skipped';

export interface ReadbackVerificationResult {
  ok: boolean;
  status: ReadbackVerificationStatus;
  message?: string;
}

type XmlRecord = Record<string, any>;

interface EncodingSignature {
  paneIndex: number;
  tag: string;
  column: string;
}

interface MarkSignature {
  paneIndex: number;
  klass: string;
}

interface FilterSignature {
  klass: string;
  column: string;
}

interface SortSignature {
  tag: 'shelf-sort-v2' | 'computed-sort';
  column: string;
  direction: string;
  using: string;
  shelf: string;
  field: string;
}

interface WorksheetSignature {
  encodings: EncodingSignature[];
  shelves: {
    rows: string[];
    cols: string[];
  };
  marks: MarkSignature[];
  filters: FilterSignature[];
  sorts: SortSignature[];
  /** column-instance names declared in datasource-dependencies, e.g. "[none:Location:nk]". */
  declaredInstances: Set<string>;
}

function isRecord(value: unknown): value is XmlRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function attr(node: XmlRecord, name: string): string {
  const value = node[`@_${name}`];
  return typeof value === 'string' ? value.trim() : '';
}

function textValue(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value).trim();
  if (isRecord(value) && typeof value['#text'] === 'string') return value['#text'].trim();
  return '';
}

function worksheetRoot(parsed: XmlRecord): XmlRecord | null {
  const rootWorksheet = normalizeArray(parsed.worksheet).find(isRecord);
  if (rootWorksheet) return rootWorksheet;
  const firstWorkbookWorksheet = normalizeArray(parsed.workbook?.worksheets?.worksheet).find(
    isRecord,
  );
  return firstWorkbookWorksheet ?? null;
}

function directChildren(parent: XmlRecord | undefined, key: string): XmlRecord[] {
  if (!parent) return [];
  return normalizeArray(parent[key]).filter(isRecord);
}

function walkElements(node: unknown, visit: (tag: string, element: XmlRecord) => void): void {
  if (!isRecord(node)) return;
  for (const [tag, value] of Object.entries(node)) {
    if (tag.startsWith('@_') || tag === '#text') continue;
    for (const child of normalizeArray(value)) {
      if (!isRecord(child)) continue;
      visit(tag, child);
      walkElements(child, visit);
    }
  }
}

function shelfValues(value: unknown): string[] {
  return normalizeArray(value)
    .flatMap((item) => textValue(item).split('/'))
    .map((item) => item.trim())
    .filter(Boolean);
}

function collectEncodings(worksheet: XmlRecord): EncodingSignature[] {
  const panes = directChildren(worksheet.table?.panes, 'pane');
  const out: EncodingSignature[] = [];
  panes.forEach((pane, paneIndex) => {
    const encodings = isRecord(pane.encodings) ? pane.encodings : undefined;
    if (!encodings) return;
    for (const [tag, value] of Object.entries(encodings)) {
      if (tag.startsWith('@_') || tag === '#text') continue;
      for (const encoding of normalizeArray(value).filter(isRecord)) {
        out.push({ paneIndex, tag, column: attr(encoding, 'column') });
      }
    }
  });
  return out;
}

function collectMarks(worksheet: XmlRecord): MarkSignature[] {
  const panes = directChildren(worksheet.table?.panes, 'pane');
  return panes.flatMap((pane, paneIndex) => {
    const mark = isRecord(pane.mark) ? pane.mark : null;
    const klass = mark ? attr(mark, 'class') : '';
    return klass ? [{ paneIndex, klass }] : [];
  });
}

function collectFilters(worksheet: XmlRecord): FilterSignature[] {
  const filters: FilterSignature[] = [];
  walkElements(worksheet, (tag, element) => {
    if (tag !== 'filter') return;
    filters.push({ klass: attr(element, 'class'), column: attr(element, 'column') });
  });
  return filters;
}

function collectDeclaredInstances(worksheet: XmlRecord): Set<string> {
  const declared = new Set<string>();
  walkElements(worksheet, (tag, element) => {
    if (tag !== 'column-instance') return;
    const name = attr(element, 'name');
    if (name) declared.add(name);
  });
  return declared;
}

/** The bracketed instance segment of an encoding column ref: "[DS].[none:X:nk]" → "[none:X:nk]". */
function instanceNameFromColumnRef(columnRef: string): string | null {
  const m = /(\[[^\]]+\])\s*$/.exec(columnRef);
  return m ? m[1] : null;
}

function collectSorts(worksheet: XmlRecord): SortSignature[] {
  const sorts: SortSignature[] = [];
  walkElements(worksheet, (tag, element) => {
    if (tag !== 'shelf-sort-v2' && tag !== 'computed-sort') return;
    sorts.push({
      tag,
      column: attr(element, 'column'),
      direction: attr(element, 'direction'),
      using: attr(element, 'using'),
      shelf: attr(element, 'shelf'),
      field: attr(element, 'field'),
    });
  });
  return sorts;
}

function signature(xml: string): WorksheetSignature | null {
  try {
    const parsed = parseXML(xml) as XmlRecord;
    const worksheet = worksheetRoot(parsed);
    if (!worksheet) return null;
    return {
      encodings: collectEncodings(worksheet),
      shelves: {
        rows: shelfValues(worksheet.table?.rows),
        cols: shelfValues(worksheet.table?.cols),
      },
      marks: collectMarks(worksheet),
      filters: collectFilters(worksheet),
      sorts: collectSorts(worksheet),
      declaredInstances: collectDeclaredInstances(worksheet),
    };
  } catch {
    return null;
  }
}

function encodingIntended(sig: EncodingSignature): string {
  return sig.column ? `<${sig.tag} column="${sig.column}">` : `<${sig.tag}>`;
}

function filterIntended(sig: FilterSignature): string {
  const klass = sig.klass ? ` class="${sig.klass}"` : '';
  const column = sig.column ? ` column="${sig.column}"` : '';
  return `<filter${klass}${column}>`;
}

function sortIntended(sig: SortSignature): string {
  const attrs = [
    sig.column ? `column="${sig.column}"` : '',
    sig.direction ? `direction="${sig.direction}"` : '',
    sig.using ? `using="${sig.using}"` : '',
    sig.shelf ? `shelf="${sig.shelf}"` : '',
    sig.field ? `field="${sig.field}"` : '',
  ]
    .filter(Boolean)
    .join(' ');
  return attrs ? `<${sig.tag} ${attrs}>` : `<${sig.tag}>`;
}

function sameEncoding(a: EncodingSignature, b: EncodingSignature): boolean {
  return a.paneIndex === b.paneIndex && a.tag === b.tag && a.column === b.column;
}

function sameFilter(a: FilterSignature, b: FilterSignature): boolean {
  return a.klass === b.klass && a.column === b.column;
}

function sameSort(a: SortSignature, b: SortSignature): boolean {
  return (
    a.tag === b.tag &&
    a.column === b.column &&
    a.direction === b.direction &&
    a.using === b.using &&
    a.shelf === b.shelf &&
    a.field === b.field
  );
}

function sortRelated(a: SortSignature, b: SortSignature): boolean {
  return a.tag === b.tag && a.column === b.column;
}

export function verifyWorksheetReadback(
  intendedXml: string,
  readbackXml: string,
): ReadbackFinding[] {
  const intended = signature(intendedXml);
  const readback = signature(readbackXml);
  if (!intended || !readback) return [];

  const findings: ReadbackFinding[] = [];

  for (const enc of intended.encodings) {
    if (readback.encodings.some((candidate) => sameEncoding(enc, candidate))) continue;
    const related = readback.encodings.some(
      (candidate) => candidate.paneIndex === enc.paneIndex && candidate.tag === enc.tag,
    );
    findings.push({
      kind: 'encoding',
      node: enc.tag,
      column: enc.column || undefined,
      intended: encodingIntended(enc),
      readback: related ? 'changed' : 'missing',
      severity: 'error',
    });
  }

  // An encoding tag can survive while its column-instance declaration is dropped —
  // the encoding is then inert (LOD encodings and their CIs are co-dependent; see
  // tactics/viz/marks-and-encodings.md). Require the declaration too. (RT finding RB-03)
  for (const enc of intended.encodings) {
    if (!enc.column) continue;
    const instanceName = instanceNameFromColumnRef(enc.column);
    if (!instanceName || !intended.declaredInstances.has(instanceName)) continue;
    if (readback.declaredInstances.has(instanceName)) continue;
    if (!readback.encodings.some((candidate) => sameEncoding(enc, candidate))) continue; // already reported above
    findings.push({
      kind: 'encoding',
      node: 'column-instance',
      column: instanceName,
      intended: `<column-instance name="${instanceName}">`,
      readback: 'missing',
      severity: 'error',
    });
  }

  for (const shelf of ['rows', 'cols'] as const) {
    for (const value of intended.shelves[shelf]) {
      if (readback.shelves[shelf].includes(value)) continue;
      findings.push({
        kind: 'shelf',
        node: shelf,
        column: value,
        intended: value,
        readback: readback.shelves[shelf].length > 0 ? 'changed' : 'missing',
        severity: 'error',
      });
    }
  }

  for (const mark of intended.marks) {
    const candidate = readback.marks.find((item) => item.paneIndex === mark.paneIndex);
    if (candidate?.klass === mark.klass) continue;
    // An authored `Automatic` mark is resolved by Tableau to a concrete class (Bar,
    // Circle, …) on readback — that is expected resolution, not a dropped mark. Any
    // concrete class in the same pane satisfies an intended `Automatic`; only a truly
    // absent mark (no candidate) is a real drop. (False-positive guard, RB readback.)
    if (mark.klass.toLowerCase() === 'automatic' && candidate) continue;
    findings.push({
      kind: 'mark',
      node: 'mark',
      intended: `<mark class="${mark.klass}">`,
      readback: candidate ? 'changed' : 'missing',
      severity: 'error',
    });
  }

  for (const filter of intended.filters) {
    if (readback.filters.some((candidate) => sameFilter(filter, candidate))) continue;
    const related = readback.filters.some((candidate) => candidate.klass === filter.klass);
    findings.push({
      kind: 'filter',
      node: 'filter',
      column: filter.column || undefined,
      intended: filterIntended(filter),
      readback: related ? 'changed' : 'missing',
      severity: 'error',
    });
  }

  for (const sort of intended.sorts) {
    if (readback.sorts.some((candidate) => sameSort(sort, candidate))) continue;
    findings.push({
      kind: 'sort',
      node: sort.tag,
      column: sort.column || undefined,
      intended: sortIntended(sort),
      readback: readback.sorts.some((candidate) => sortRelated(sort, candidate))
        ? 'changed'
        : 'missing',
      severity: 'warning',
    });
  }

  return findings;
}

export function formatReadbackFinding(finding: ReadbackFinding): string {
  const column = finding.column ? ` column="${finding.column}"` : '';
  return `<${finding.node}${column}>`;
}

export function formatReadbackVerificationError(findings: ReadbackFinding[]): string {
  const errors = findings.filter((finding) => finding.severity === 'error');
  if (errors.length === 0) return '';
  return (
    `apply succeeded but Tableau silently dropped: ${errors.map(formatReadbackFinding).join(', ')}. ` +
    'The rendered chart does NOT match the intent — likely an invalid/unsupported node. ' +
    'Fix the worksheet XML to use Tableau-supported shelf, mark, filter, and encoding nodes, then re-apply.'
  );
}

export function formatReadbackVerificationStatus(
  result: ReadbackVerificationResult | undefined,
): string {
  if (result?.status !== 'skipped') return '';
  return 'Apply succeeded, but could not verify (readback unavailable). Re-read the worksheet before relying on the result.';
}

export function formatReadbackVerificationWarnings(findings: ReadbackFinding[]): string {
  const warnings = findings.filter((finding) => finding.severity === 'warning');
  if (warnings.length === 0) return '';
  return `\n\n⚠️ Readback verification warning — Tableau changed or dropped: ${warnings.map(formatReadbackFinding).join(', ')}. Re-check the rendered chart before moving on.`;
}
