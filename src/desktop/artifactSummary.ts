import { createHash } from 'crypto';

type ArtifactKind = 'workbook' | 'worksheet' | 'dashboard';

function attr(tag: string, name: string): string | null {
  const re = new RegExp(`${name}\\s*=\\s*(['"])(.*?)\\1`, 'i');
  return tag.match(re)?.[2] ?? null;
}

function uniq(xs: Array<string | null | undefined>): string[] {
  return [...new Set(xs.filter((x): x is string => Boolean(x)))];
}

function truncate(xs: string[], max = 6): string {
  if (!xs.length) return '(none)';
  const shown = xs.slice(0, max).join(', ');
  return xs.length > max ? `${shown}, +${xs.length - max} more` : shown;
}

function clip(value: string | null, max = 110): string {
  if (!value) return '(empty)';
  return value.length > max ? `${value.slice(0, max - 3)}...` : value;
}

function firstTag(xml: string, tagName: string): string | null {
  return xml.match(new RegExp(`<${tagName}\\b[^>]*>`, 'i'))?.[0] ?? null;
}

function tagAttrs(xml: string, tagName: string, attrName: string): string[] {
  return uniq(
    [...xml.matchAll(new RegExp(`<${tagName}\\b[^>]*>`, 'gi'))].map((m) => attr(m[0], attrName)),
  );
}

function textOf(xml: string, tagName: string): string | null {
  const m = xml.match(new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)</${tagName}>`, 'i'));
  return m?.[1]?.trim() || null;
}

// A deterministic, structural summary (bytes + sha256 + shape) of an XML
// artifact, so an agent can self-verify what was cached before applying it.
export function summarizeXmlArtifact(kind: ArtifactKind, xml: string): string[] {
  const datasources = tagAttrs(xml, 'datasource', 'caption');
  const datasourceNames = tagAttrs(xml, 'datasource', 'name');
  const ds = datasources.length ? datasources : datasourceNames;
  const lines: string[] = [
    `bytes: ${Buffer.byteLength(xml, 'utf8')}`,
    `sha256: ${createHash('sha256').update(xml).digest('hex')}`,
  ];

  if (kind === 'workbook') {
    const worksheets = tagAttrs(xml, 'worksheet', 'name');
    const dashboards = tagAttrs(xml, 'dashboard', 'name');
    lines.push(
      `worksheets: ${worksheets.length}${worksheets.length ? ` (${truncate(worksheets)})` : ''}`,
    );
    lines.push(
      `dashboards: ${dashboards.length}${dashboards.length ? ` (${truncate(dashboards)})` : ''}`,
    );
    lines.push(`datasources: ${truncate(ds)}`);
    lines.push(`columns: ${(xml.match(/<column\b/gi) ?? []).length}`);
    return lines;
  }

  if (kind === 'worksheet') {
    const worksheetName = attr(firstTag(xml, 'worksheet') ?? '', 'name') ?? '(unknown)';
    const markClass = attr(firstTag(xml, 'mark') ?? '', 'class') ?? '(unknown)';
    lines.push(`worksheet: ${worksheetName}`);
    lines.push(`datasources: ${truncate(ds)}`);
    lines.push(`mark: ${markClass}`);
    lines.push(`rows: ${clip(textOf(xml, 'rows'))}`);
    lines.push(`cols: ${clip(textOf(xml, 'cols'))}`);
    lines.push(
      `encodings: ${(xml.match(/<(color|size|text|lod|shape|wedge|custom)\b/gi) ?? []).length}`,
    );
    return lines;
  }

  const dashboardName = attr(firstTag(xml, 'dashboard') ?? '', 'name') ?? '(unknown)';
  lines.push(`dashboard: ${dashboardName}`);
  lines.push(`zones: ${(xml.match(/<zone\b/gi) ?? []).length}`);
  lines.push(`worksheets referenced: ${truncate(tagAttrs(xml, 'zone', 'name'))}`);
  return lines;
}

// One-line-per-entry block suitable for appending to a tool's text message.
export function formatArtifactSummary(kind: ArtifactKind, xml: string): string {
  return summarizeXmlArtifact(kind, xml)
    .map((line) => `- ${line}`)
    .join('\n');
}
