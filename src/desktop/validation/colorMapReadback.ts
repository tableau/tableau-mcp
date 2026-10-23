/**
 * Categorical color map readback.
 *
 * Desktop can accept a raw-XML apply that carries a `<style>` color map and silently drop the map
 * (for example when the datasource has no `<column-instance>` for the colored field). Wherever the
 * map was authored, a surviving map lives in the owning datasource document, so the check compares
 * the requested member colors against that document's `<style>` block. No API calls here.
 */
import { normalizeArray, parseXML } from '../metadata/parser.js';
import type { ReadbackVerificationResult, VerificationFinding } from './readback-verify.js';

export interface ColorMap {
  /** Internal datasource name (the XML `name` attribute). */
  datasource: string;
  /** Column-instance field the encoding colors, e.g. `[none:Category:nk]`. */
  field: string;
  /** Bucket value (quotes stripped) to lowercase `#rrggbb`. */
  members: Map<string, string>;
}

type XmlRecord = Record<string, any>;

const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const NUMERIC_BUCKET = /^-?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/;
const ISO_DATE_BUCKET = /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?)?$/;

function isRecord(value: unknown): value is XmlRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function records(value: unknown): XmlRecord[] {
  return normalizeArray(value).filter(isRecord);
}

function textValue(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (isRecord(value) && typeof value['#text'] === 'string') return value['#text'];
  return undefined;
}

// Numeric, #date# and %…% buckets (quoted or not) are reformatted by Desktop on readback, so only
// string members are compared; booleans stay exact because Desktop drops `True` and "true".
function bucketKey(text: string): string | undefined {
  const raw = text.trim();
  const quoted = raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"');
  const value = quoted ? raw.slice(1, -1).trim() : raw;
  const reformatted =
    NUMERIC_BUCKET.test(value) ||
    ISO_DATE_BUCKET.test(value) ||
    (value.length >= 2 && value.startsWith('#') && value.endsWith('#')) ||
    (value.length >= 2 && value.startsWith('%') && value.endsWith('%'));
  if (reformatted) return undefined;
  return quoted ? raw.slice(1, -1) : raw;
}

function colorMapsInStyle(
  style: XmlRecord,
  resolveDatasource: (rawField: string) => string | undefined,
): ColorMap[] {
  const maps: ColorMap[] = [];
  for (const rule of records(style['style-rule'])) {
    if (rule['@_element'] !== 'mark') continue;
    for (const encoding of records(rule.encoding)) {
      const rawField = encoding['@_field'];
      if (encoding['@_attr'] !== 'color' || encoding['@_type'] !== 'palette') continue;
      if (typeof rawField !== 'string' || rawField.includes('\n') || rawField.includes('&#10;')) {
        continue;
      }
      const datasource = resolveDatasource(rawField);
      if (datasource === undefined) continue;
      // A qualified `[ds].[field]` names the same field the datasource keys as `[field]`.
      const qualifier = `[${datasource}].`;
      const field = rawField.startsWith(qualifier) ? rawField.slice(qualifier.length) : rawField;
      const members = new Map<string, string>();
      for (const map of records(encoding.map)) {
        const to = map['@_to'];
        if (typeof to !== 'string' || !HEX_COLOR.test(to)) continue;
        for (const bucket of normalizeArray(map.bucket)) {
          const raw = textValue(bucket);
          const key = raw === undefined ? undefined : bucketKey(raw);
          if (key !== undefined) members.set(key, to.toLowerCase());
        }
      }
      if (members.size > 0) maps.push({ datasource, field, members });
    }
  }
  return maps;
}

/** Datasource-level elements: a datasource document root, or a workbook's `<datasources>`. */
function datasourceElements(root: XmlRecord): XmlRecord[] {
  if (isRecord(root.datasource)) return [root.datasource];
  if (isRecord(root.workbook)) return records(root.workbook.datasources?.datasource);
  return [];
}

function worksheetElements(root: XmlRecord): XmlRecord[] {
  if (root.worksheet !== undefined) return records(root.worksheet);
  if (isRecord(root.workbook) && isRecord(root.workbook.worksheets)) {
    return records(root.workbook.worksheets.worksheet);
  }
  return [];
}

/**
 * Every categorical color map an XML document carries, from datasource roots, workbook
 * datasources and worksheet `<datasource-dependencies>`. Copies of one field collapse to a single
 * map; per member the last copy in document order wins as the intended color (`winner: 'first'`
 * for a readback). `undefined` means the XML could not
 * be parsed or is not a datasource, workbook or worksheet document.
 */
export function extractColorMaps(
  xml: string,
  { winner = 'last' }: { winner?: 'first' | 'last' } = {},
): ColorMap[] | undefined {
  let root: XmlRecord;
  try {
    root = parseXML(xml) as XmlRecord;
  } catch {
    return undefined;
  }
  if (!isRecord(root.datasource) && !isRecord(root.workbook) && root.worksheet === undefined) {
    return undefined;
  }

  const maps: ColorMap[] = [];
  for (const datasource of datasourceElements(root)) {
    const name = datasource['@_name'];
    if (typeof name !== 'string') continue;
    for (const style of records(datasource.style))
      maps.push(...colorMapsInStyle(style, () => name));
  }
  for (const worksheet of worksheetElements(root)) {
    for (const table of records(worksheet.table)) {
      for (const view of records(table.view)) {
        for (const dependencies of records(view['datasource-dependencies'])) {
          const name = dependencies['@_datasource'];
          if (typeof name !== 'string') continue;
          for (const style of records(dependencies.style)) {
            maps.push(...colorMapsInStyle(style, () => name));
          }
        }
      }
    }
  }
  return mergeMaps(maps, winner);
}

// Identical copies collapse; copies that differ are kept, so a comparison can accept any of them.
function dedupeMaps(maps: ColorMap[]): ColorMap[] {
  const seen = new Set<string>();
  return maps.filter((map) => {
    const signature = JSON.stringify([map.datasource, map.field, [...map.members].sort()]);
    if (seen.has(signature)) return false;
    seen.add(signature);
    return true;
  });
}

function mergeMaps(maps: ColorMap[], winner: 'first' | 'last'): ColorMap[] {
  const merged = new Map<string, ColorMap>();
  for (const map of maps) {
    const key = JSON.stringify([map.datasource, map.field]);
    const entry = merged.get(key);
    if (entry === undefined) merged.set(key, { ...map, members: new Map(map.members) });
    else {
      for (const [bucket, hex] of map.members) {
        if (winner === 'last' || !entry.members.has(bucket)) entry.members.set(bucket, hex);
      }
    }
  }
  return [...merged.values()];
}

// Every `<style>` below a worksheet table except the ones inside `<datasource-dependencies>`.
function collectTableStyles(node: XmlRecord, out: XmlRecord[]): void {
  for (const [key, value] of Object.entries(node)) {
    if (key.startsWith('@_') || key === 'datasource-dependencies') continue;
    for (const child of records(value)) {
      if (key === 'style') out.push(child);
      collectTableStyles(child, out);
    }
  }
}

export const STALE_REASON = 'color-worksheet-style-stale';
const BASELINE_UNAVAILABLE_REASON = 'color-baseline-unavailable';

// Notes about the sheet's own <style>; they never change whether the requested colors took.
function isStaleNote(finding: VerificationFinding): boolean {
  return finding.reason === STALE_REASON || finding.reason === BASELINE_UNAVAILABLE_REASON;
}

const MEASURE_NAMES = '[:Measure Names]';
const QUALIFIED_FIELD = /^\[([^\]]+)\]\.\[/;

/**
 * Categorical color maps a worksheet writes in its own `<style>` (the table's, a pane's, any
 * depth), which Desktop keeps but the chart ignores. `<datasource-dependencies>` styles are left
 * to `extractColorMaps`. The datasource comes from the field's `[ds].` prefix, else from the one
 * non-Parameters datasource the sheet uses; otherwise the map is skipped.
 */
export function extractWorksheetStyleColorMaps(xml: string): ColorMap[] {
  let root: XmlRecord;
  try {
    root = parseXML(xml) as XmlRecord;
  } catch {
    return [];
  }
  const maps: ColorMap[] = [];
  for (const worksheet of worksheetElements(root)) {
    for (const table of records(worksheet.table)) {
      const used = records(table.view).flatMap((view) =>
        records(view['datasource-dependencies']).flatMap((dependencies) => {
          const name = dependencies['@_datasource'];
          return typeof name === 'string' && name !== 'Parameters' ? [name] : [];
        }),
      );
      const sole = new Set(used).size === 1 ? used[0] : undefined;
      const styles: XmlRecord[] = [];
      collectTableStyles(table, styles);
      for (const style of styles) {
        maps.push(
          ...colorMapsInStyle(style, (rawField) => QUALIFIED_FIELD.exec(rawField)?.[1] ?? sole),
        );
      }
    }
  }
  return dedupeMaps(maps);
}

function memberIn({
  maps,
  map,
  bucket,
  hex,
}: {
  maps: readonly ColorMap[];
  map: ColorMap;
  bucket: string;
  hex: string;
}): boolean {
  return maps.some(
    (candidate) =>
      candidate.datasource === map.datasource &&
      candidate.field === map.field &&
      candidate.members.get(bucket) === hex,
  );
}

/**
 * Split worksheet-style maps into members the payload newly authored and members already in the
 * baseline (stale: Desktop keeps them and hands them back on every read). With no baseline every
 * member is stale, so the check can warn but never fail.
 */
export function splitWorksheetStyleColorMaps(
  maps: readonly ColorMap[],
  baseline: readonly ColorMap[] | undefined,
): { authored: ColorMap[]; stale: ColorMap[] } {
  const authored: ColorMap[] = [];
  const stale: ColorMap[] = [];
  for (const map of maps) {
    const fresh = new Map<string, string>();
    const old = new Map<string, string>();
    for (const [bucket, hex] of map.members) {
      (baseline !== undefined && !memberIn({ maps: baseline, map, bucket, hex }) ? fresh : old).set(
        bucket,
        hex,
      );
    }
    if (fresh.size > 0) authored.push({ ...map, members: fresh });
    if (old.size > 0) stale.push({ ...map, members: old });
  }
  return { authored, stale };
}

/** One warning per field whose stale worksheet-style members the datasource does not carry. */
export function staleWorksheetStyleFindings(
  stale: readonly ColorMap[],
  readback: readonly ColorMap[],
): VerificationFinding[] {
  const findings: VerificationFinding[] = [];
  for (const map of stale) {
    const unused = [...map.members]
      .filter(([bucket, hex]) => !memberIn({ maps: readback, map, bucket, hex }))
      .map(([bucket, hex]) => {
        const chart = readback
          .filter((copy) => copy.datasource === map.datasource && copy.field === map.field)
          .map((copy) => copy.members.get(bucket))
          .find((value) => value !== undefined);
        return `${bucket} ${hex} (${chart === undefined ? 'not in the datasource' : `the chart uses ${chart}`})`;
      });
    if (unused.length === 0) continue;
    findings.push({
      severity: 'warning',
      source: 'color-map',
      message: `the worksheet's own <style> also lists member colors for ${map.field} that the chart does not use: ${unused.join(', ')}`,
      datasource: map.datasource,
      fieldName: map.field,
      reason: STALE_REASON,
    });
  }
  return findings;
}

/** Added beside stale notes when the sheet could not be read before the apply. */
export function colorBaselineUnavailableFinding(): VerificationFinding {
  return {
    severity: 'warning',
    source: 'color-map',
    message: 'The sheet could not be read before the apply, so some of these may be new',
    reason: BASELINE_UNAVAILABLE_REASON,
  };
}

/**
 * One error finding per requested bucket the readback does not carry. A bucket passes when any
 * readback copy for its (datasource, field) maps it to any color an intended copy requested.
 */
export function compareColorMaps(
  intended: readonly ColorMap[],
  readback: readonly ColorMap[],
): VerificationFinding[] {
  const requested = new Map<
    string,
    { datasource: string; field: string; bucket: string; hexes: string[] }
  >();
  for (const map of intended) {
    for (const [bucket, hex] of map.members) {
      const key = JSON.stringify([map.datasource, map.field, bucket]);
      const entry = requested.get(key) ?? {
        datasource: map.datasource,
        field: map.field,
        bucket,
        hexes: [],
      };
      if (!entry.hexes.includes(hex)) entry.hexes.push(hex);
      requested.set(key, entry);
    }
  }

  const findings: VerificationFinding[] = [];
  for (const { datasource, field, bucket, hexes } of requested.values()) {
    const copies = readback.filter(
      (candidate) => candidate.datasource === datasource && candidate.field === field,
    );
    const found = copies.map((copy) => copy.members.get(bucket));
    if (found.some((value) => value !== undefined && hexes.includes(value))) continue;
    const foundHex = found.find((value) => value !== undefined);
    findings.push({
      severity: 'error',
      source: 'color-map',
      message: `${field}: ${bucket} expected ${hexes.join(' or ')}, found ${foundHex ?? 'missing'}`,
      datasource,
      fieldName: field,
      reason:
        copies.length === 0
          ? 'color-map-dropped'
          : foundHex === undefined
            ? 'color-member-missing'
            : 'color-mismatch',
    });
  }
  return findings;
}

/** Warning finding for a color readback that could not run; it never fails the check. */
export function colorReadbackUnavailableFinding(
  datasource: string,
  detail: string,
): VerificationFinding {
  return {
    severity: 'warning',
    source: 'color-map',
    message: `color readback unavailable for datasource "${datasource}": ${detail}`,
    datasource,
    reason: 'color-readback-unavailable',
  };
}

// Fields whose applied datasource-level element lacks a direct `<column-instance name=F>`; a
// worksheet-only payload has no such element, and Desktop adds the instance itself on that route.
function fieldsMissingColumnInstance(
  findings: readonly VerificationFinding[],
  appliedXml: string,
): string[] {
  let root: XmlRecord;
  try {
    root = parseXML(appliedXml) as XmlRecord;
  } catch {
    return [];
  }
  const elements = datasourceElements(root);
  const missing = new Set<string>();
  for (const finding of findings) {
    if (finding.fieldName === undefined || finding.fieldName === MEASURE_NAMES) continue;
    const element = elements.find((candidate) => candidate['@_name'] === finding.datasource);
    if (element === undefined) continue;
    const hasInstance = records(element['column-instance']).some(
      (instance) => instance['@_name'] === finding.fieldName,
    );
    if (!hasInstance) missing.add(finding.fieldName);
  }
  return [...missing];
}

/**
 * Fold color findings into the shared verification shape; errors fail, warnings only warn. Stale
 * worksheet-style notes ride along in `findings` but never change the status. With no requested
 * map (`hasIntended: false`) the result is `skipped`: it claims neither a pass nor a failure.
 */
export function colorMapVerificationResult(
  findings: readonly VerificationFinding[],
  appliedXml: string,
  { hasIntended = true, worksheetStylePlacement = false, existingMapNotReplaced = false } = {},
): ReadbackVerificationResult {
  const notes = findings.filter(isStaleNote);
  const checked = findings.filter((finding) => !isStaleNote(finding));
  if (!hasIntended) return { ok: true, status: 'skipped', findings: [...findings] };
  const errors = checked.filter((finding) => finding.severity === 'error');
  if (errors.length > 0) {
    const missingInstances = fieldsMissingColumnInstance(errors, appliedXml);
    const hint =
      missingInstances.length === 0
        ? ''
        : ` The datasource needs a <column-instance> for ${missingInstances.join(', ')} next to its <style>.`;
    const worksheetStyleHint = worksheetStylePlacement
      ? " Desktop keeps member colors written in a worksheet's own <style>, and the chart ignores them; put them in the datasource <style> with a datasource-level <column-instance>."
      : '';
    const notReplacedHint = existingMapNotReplaced
      ? ' apply-workbook does not replace a datasource color map that already exists; change member colors with apply-datasource.'
      : '';
    return {
      ok: false,
      status: 'failed',
      message: `${errors.length} requested member color(s) did not take: ${errors
        .map((finding) => finding.message)
        .join(
          '; ',
        )}. Do not tell the user these colors are set.${hint}${worksheetStyleHint}${notReplacedHint}`,
      findings: [...findings],
    };
  }
  if (checked.length > 0) {
    return {
      ok: true,
      status: 'warning',
      message: checked.map((finding) => finding.message).join('; '),
      findings: [...findings],
    };
  }
  return notes.length > 0
    ? { ok: true, status: 'passed', findings: notes }
    : { ok: true, status: 'passed' };
}

/**
 * Merge a color check into a worksheet readback result: a failed color check fails the merged
 * result, a warning turns a passed result into a warning, and a pass or skip only adds its notes.
 */
export function mergeColorMapVerification(
  base: ReadbackVerificationResult | undefined,
  color: ReadbackVerificationResult | undefined,
): ReadbackVerificationResult | undefined {
  if (color === undefined) return base;
  if (color.status === 'passed' || color.status === 'skipped') {
    const notes = color.findings ?? [];
    return base === undefined || notes.length === 0
      ? base
      : { ...base, findings: [...(base.findings ?? []), ...notes] };
  }
  // With no structural readback, a color warning alone must not read as verified.
  if (base === undefined) {
    return color.status === 'failed'
      ? color
      : { ok: true, status: 'skipped', message: color.message, findings: color.findings };
  }
  const findings = [...(base.findings ?? []), ...(color.findings ?? [])];
  if (color.status === 'failed') {
    return {
      ok: false,
      status: 'failed',
      message: [base.message, color.message].filter(Boolean).join(' '),
      findings,
    };
  }
  const merged = { ...base, findings };
  // A color warning must not leave a passed base reading as fully verified.
  return base.status === 'passed'
    ? { ...merged, status: 'warning', message: color.message }
    : merged;
}

/**
 * Opens an apply message when the sheet's own `<style>` keeps member colors the chart ignores;
 * empty when none. Trailing space included, so callers prepend it.
 */
export function formatStaleWorksheetStyleLead(
  verification: ReadbackVerificationResult | undefined,
): string {
  const findings = verification?.findings ?? [];
  const stale = findings.filter((finding) => finding.reason === STALE_REASON);
  if (stale.length === 0) return '';
  const unread = findings.some((finding) => finding.reason === BASELINE_UNAVAILABLE_REASON);
  return `Applied, but the member colors in the worksheet's own <style> are not shown on the chart and are not set. Details: ${stale.map((finding) => finding.message).join('; ')}. Do not tell the user they are set. To color the chart, put them in the datasource <style> with a datasource-level <column-instance> (apply-datasource).${unread ? ` ${colorBaselineUnavailableFinding().message}.` : ''} `;
}

/** Host verification text for a color check; a failure is carried by the headline instead. */
export function formatColorMapCheck(verification: ReadbackVerificationResult): string {
  if (verification.status === 'passed') {
    return ' Read back the datasource document: every requested member color matched.';
  }
  if (verification.status === 'warning') {
    return ` Requested member colors are not verified: ${verification.message ?? 'color readback unavailable'}.`;
  }
  return '';
}
