import { normalizeArray, parseXML } from '../../../../desktop/metadata/parser.js';
import { attrOf, type Bucket, splitColumnRef } from './memberColorsSplice.js';

type XmlRecord = Record<string, any>;

export type MemberColor = { member: string; color: string };
/** `known` is set only when the field already has a color map to compare against. */
export type MatchedBucket = Bucket & { known?: boolean };

export type ColorTarget = {
  datasource: string;
  /** Datasource-level column-instance name, e.g. `[none:Category:nk]`. */
  instance: string;
  /** Datasource column name, e.g. `[Category]`. */
  column: string;
  label: string;
  datatype: 'string' | 'boolean';
  /** The worksheet's own `<column-instance>` element, copied when the datasource lacks one. */
  instanceXml: string;
};

export type TargetResult = { ok: true; target: ColorTarget } | { ok: false; message: string };

const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const PUT_FIELD_ON_COLOR = 'Put a discrete field on Color first.';

function isRecord(value: unknown): value is XmlRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function records(value: unknown): XmlRecord[] {
  return normalizeArray(value).filter(isRecord);
}

function stripBrackets(name: string): string {
  return name.replace(/^\[:?/, '').replace(/\]$/, '');
}

/**
 * Validates the request and returns each member's datasource bucket text, e.g. `"Furniture"`.
 * With `existing` buckets, a string member matches one case-insensitively and takes its spelling.
 */
export function buildBuckets(
  colors: readonly MemberColor[],
  datatype: 'string' | 'boolean',
  existing?: readonly string[],
): { ok: true; buckets: MatchedBucket[] } | { ok: false; message: string } {
  const seen = new Set<string>();
  const buckets: MatchedBucket[] = [];
  for (const { member, color } of colors) {
    if (!HEX_COLOR.test(color)) {
      return { ok: false, message: `Color "${color}" for "${member}" must be #rrggbb.` };
    }
    let bucket: string;
    let displayMember = member;
    let known: boolean | undefined;
    if (datatype === 'boolean') {
      displayMember = member.trim().toLowerCase();
      if (displayMember !== 'true' && displayMember !== 'false') {
        return {
          ok: false,
          message: `Member "${member}" is not valid for a boolean field; use true or false.`,
        };
      }
      bucket = displayMember;
    } else {
      if (member.length === 0 || member.includes('"')) {
        return {
          ok: false,
          message: `Member "${member}" must be non-empty and contain no double quotes.`,
        };
      }
      const unquote = (candidate: string): string => candidate.replace(/^"|"$/g, '').trim();
      const trimmed = member.trim();
      const match =
        existing?.find((candidate) => unquote(candidate) === trimmed) ??
        existing?.find((candidate) => unquote(candidate).toLowerCase() === trimmed.toLowerCase());
      if (match === undefined) {
        bucket = `"${member}"`;
        known = existing === undefined ? undefined : false;
      } else {
        bucket = match;
        displayMember = match.replace(/^"|"$/g, '');
        known = true;
      }
    }
    if (seen.has(bucket)) {
      return { ok: false, message: `Member "${member}" is listed more than once.` };
    }
    seen.add(bucket);
    buckets.push({ member: displayMember, bucket, color: color.toLowerCase(), known });
  }
  return { ok: true, buckets };
}

type Candidate = {
  datasource: string;
  instance: string;
  column: string;
  caption?: string;
  instanceRecord?: XmlRecord;
  columnRecord?: XmlRecord;
};

/** Resolve which field is on Color, or why the tool cannot color it. */
export function resolveColorTarget(worksheetXml: string, requestedField?: string): TargetResult {
  let root: XmlRecord;
  try {
    root = parseXML(worksheetXml) as XmlRecord;
  } catch {
    return { ok: false, message: 'The worksheet could not be parsed.' };
  }
  const worksheet = records(root.worksheet)[0];
  const table = isRecord(worksheet?.table) ? worksheet.table : undefined;
  if (table === undefined) {
    return { ok: false, message: PUT_FIELD_ON_COLOR };
  }

  const dependencies = records(table.view?.['datasource-dependencies']);
  const dataDependencies = dependencies.filter((entry) => entry['@_datasource'] !== 'Parameters');
  const soleDatasource =
    dataDependencies.length === 1 ? (dataDependencies[0]['@_datasource'] as string) : undefined;

  const refs: string[] = [];
  for (const pane of records(table.panes?.pane)) {
    const colors = records(pane.encodings?.color)
      .map((color) => color['@_column'])
      .filter((column): column is string => typeof column === 'string');
    if (new Set(colors).size > 1) {
      return {
        ok: false,
        message: 'More than one field is on Color; this tool needs exactly one.',
      };
    }
    for (const column of colors) if (!refs.includes(column)) refs.push(column);
  }

  const candidates: Candidate[] = [];
  for (const ref of refs) {
    const { datasource = soleDatasource, instance } = splitColumnRef(ref);
    if (datasource === undefined) continue;
    const entry = dependencies.find((candidate) => candidate['@_datasource'] === datasource);
    const instanceRecord = records(entry?.['column-instance']).find(
      (candidate) => candidate['@_name'] === instance,
    );
    const column =
      typeof instanceRecord?.['@_column'] === 'string' ? instanceRecord['@_column'] : instance;
    const columnRecord = records(entry?.column).find((candidate) => candidate['@_name'] === column);
    candidates.push({
      datasource,
      instance,
      column,
      caption: columnRecord?.['@_caption'],
      instanceRecord,
      columnRecord,
    });
  }

  if (candidates.length === 0) {
    return { ok: false, message: PUT_FIELD_ON_COLOR };
  }
  const nameOf = (candidate: Candidate): string =>
    candidate.caption ?? stripBrackets(candidate.column);
  let chosen: Candidate;
  if (requestedField === undefined || requestedField.trim() === '') {
    if (candidates.length > 1) {
      return {
        ok: false,
        message: `Several fields are on Color across the sheet's panes: ${candidates
          .map(nameOf)
          .join(', ')}. Pass field to choose one.`,
      };
    }
    chosen = candidates[0];
  } else {
    const wanted = stripBrackets(requestedField.trim()).toLowerCase();
    const matches = candidates.filter((candidate) =>
      [candidate.instance, candidate.column, candidate.caption ?? '']
        .map((value) => stripBrackets(value).toLowerCase())
        .includes(wanted),
    );
    if (matches.length !== 1) {
      return {
        ok: false,
        message: `Field "${requestedField}" ${matches.length === 0 ? 'is not on Color' : 'matches several fields on Color'}. Fields on Color: ${candidates
          .map(nameOf)
          .join(', ')}.`,
      };
    }
    chosen = matches[0];
  }

  const label = nameOf(chosen);
  if (/:Measure Names\]|Multiple Values/.test(chosen.instance)) {
    return { ok: false, message: 'Measure Names and Measure Values colors are not supported.' };
  }
  if (chosen.instanceRecord?.['@_derivation'] === 'InOut' || chosen.instance.startsWith('[io:')) {
    return { ok: false, message: `"${label}" is a set; colors can be set only on fields.` };
  }
  if (chosen.instanceRecord === undefined) {
    return { ok: false, message: `Field "${label}" was not found among the sheet's fields.` };
  }
  if (chosen.instanceRecord['@_type'] === 'quantitative' || /:qk\]$/.test(chosen.instance)) {
    return { ok: false, message: `"${label}" is continuous; put a discrete field on Color.` };
  }
  if (chosen.columnRecord?.calculation?.['@_class'] === 'categorical-bin') {
    return { ok: false, message: `"${label}" is a group; colors can be set only on fields.` };
  }
  // Read from the column, never the derivation prefix: a boolean calculation is `none:`.
  const datatype = chosen.columnRecord?.['@_datatype'];
  if (datatype !== 'string' && datatype !== 'boolean') {
    return {
      ok: false,
      message: `"${label}" has datatype ${String(datatype)}; only string and boolean fields are supported.`,
    };
  }

  const instanceXml = findInstanceXml(worksheetXml, chosen.datasource, chosen.instance);
  if (instanceXml === undefined) {
    return { ok: false, message: `Field "${label}" has no column-instance on the sheet.` };
  }
  return {
    ok: true,
    target: {
      datasource: chosen.datasource,
      instance: chosen.instance,
      column: chosen.column,
      label,
      datatype,
      instanceXml,
    },
  };
}

function findInstanceXml(
  worksheetXml: string,
  datasource: string,
  instance: string,
): string | undefined {
  const blocks = worksheetXml.matchAll(
    /<datasource-dependencies\b((?:[^>'"]|'[^']*'|"[^"]*")*)>([\s\S]*?)<\/datasource-dependencies>/g,
  );
  for (const [, openAttrs, inner] of blocks) {
    if (attrOf(`<x ${openAttrs}>`, 'datasource') !== datasource) continue;
    for (const match of inner.matchAll(/<column-instance\b(?:[^>'"]|'[^']*'|"[^"]*")*>/g)) {
      if (attrOf(match[0], 'name') !== instance) continue;
      if (match[0].endsWith('/>')) return match[0];
      const close = inner.indexOf('</column-instance>', match.index);
      return close === -1
        ? undefined
        : inner.slice(match.index, close + '</column-instance>'.length);
    }
  }
  return undefined;
}
