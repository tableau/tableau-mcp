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
const NUMERIC_BUCKET = /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/;

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

// String buckets are quoted; numeric, #date# and %null% buckets are reformatted by Desktop on
// readback, so only string members are compared.
function bucketKey(text: string): string | undefined {
  const raw = text.trim();
  if (raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"')) return raw.slice(1, -1);
  if (raw === '%null%' || (raw.startsWith('#') && raw.endsWith('#')) || NUMERIC_BUCKET.test(raw)) {
    return undefined;
  }
  return raw;
}

function colorMapsInStyle(style: XmlRecord, datasource: string): ColorMap[] {
  const maps: ColorMap[] = [];
  for (const rule of records(style['style-rule'])) {
    if (rule['@_element'] !== 'mark') continue;
    for (const encoding of records(rule.encoding)) {
      const rawField = encoding['@_field'];
      if (encoding['@_attr'] !== 'color' || encoding['@_type'] !== 'palette') continue;
      if (typeof rawField !== 'string' || rawField.includes('\n') || rawField.includes('&#10;')) {
        continue;
      }
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

function membersSignature(map: ColorMap): string {
  return JSON.stringify([map.datasource, map.field, [...map.members].sort()]);
}

/**
 * Every categorical color map an XML document carries, from datasource roots, workbook
 * datasources and worksheet `<datasource-dependencies>`. Identical copies collapse to one; copies
 * that differ are kept so a comparison can accept any of them. `undefined` means the XML could not
 * be parsed or is not a datasource, workbook or worksheet document.
 */
export function extractColorMaps(xml: string): ColorMap[] | undefined {
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
    for (const style of records(datasource.style)) maps.push(...colorMapsInStyle(style, name));
  }
  for (const worksheet of worksheetElements(root)) {
    for (const table of records(worksheet.table)) {
      for (const view of records(table.view)) {
        for (const dependencies of records(view['datasource-dependencies'])) {
          const name = dependencies['@_datasource'];
          if (typeof name !== 'string') continue;
          for (const style of records(dependencies.style)) {
            maps.push(...colorMapsInStyle(style, name));
          }
        }
      }
    }
  }

  const seen = new Set<string>();
  return maps.filter((map) => {
    const signature = membersSignature(map);
    if (seen.has(signature)) return false;
    seen.add(signature);
    return true;
  });
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
    if (finding.fieldName === undefined) continue;
    const element = elements.find((candidate) => candidate['@_name'] === finding.datasource);
    if (element === undefined) continue;
    const hasInstance = records(element['column-instance']).some(
      (instance) => instance['@_name'] === finding.fieldName,
    );
    if (!hasInstance) missing.add(finding.fieldName);
  }
  return [...missing];
}

/** Fold color findings into the shared verification shape; errors fail, warnings only warn. */
export function colorMapVerificationResult(
  findings: readonly VerificationFinding[],
  appliedXml: string,
): ReadbackVerificationResult {
  const errors = findings.filter((finding) => finding.severity === 'error');
  if (errors.length > 0) {
    const missingInstances = fieldsMissingColumnInstance(errors, appliedXml);
    const hint =
      missingInstances.length === 0
        ? ''
        : ` The datasource needs a <column-instance> for ${missingInstances.join(', ')} next to its <style>.`;
    return {
      ok: false,
      status: 'failed',
      message: `${errors.length} requested member color(s) did not take: ${errors
        .map((finding) => finding.message)
        .join('; ')}. Do not tell the user these colors are set.${hint}`,
      findings: [...findings],
    };
  }
  if (findings.length > 0) {
    return {
      ok: true,
      status: 'warning',
      message: findings.map((finding) => finding.message).join('; '),
      findings: [...findings],
    };
  }
  return { ok: true, status: 'passed' };
}

/**
 * Merge a color check into a worksheet readback result: a failed color check fails the merged
 * result, a warning adds its findings without changing the status, and a pass changes nothing.
 */
export function mergeColorMapVerification(
  base: ReadbackVerificationResult | undefined,
  color: ReadbackVerificationResult | undefined,
): ReadbackVerificationResult | undefined {
  if (color === undefined || color.status === 'passed') return base;
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
  return { ...base, findings };
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
