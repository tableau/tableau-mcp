import type { Family, RuntimeTemplateDescriptor } from '../binder/manifest-types.js';
import {
  listTemplateCatalog,
  readBookmarkFromCatalogEntry,
  type TemplateCatalogOptions,
} from './templatePath.js';
import {
  createTemplateRuntimeSnapshot,
  type TemplateRuntimeSnapshot,
} from './templateRuntimeSnapshot.js';

const FAMILY_PREFIXES: ReadonlyArray<[string, Family]> = [
  ['change-over-time', 'time-series'],
  ['time-series', 'time-series'],
  ['ranking', 'ranking'],
  ['part-to-whole', 'part-to-whole'],
  ['correlation', 'correlation'],
  ['distribution', 'distribution'],
  ['deviation', 'deviation'],
  ['magnitude', 'magnitude'],
  ['spatial', 'spatial'],
  ['kpi', 'kpi'],
];

const TOKEN_STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'as',
  'by',
  'for',
  'from',
  'in',
  'into',
  'of',
  'on',
  'or',
  'over',
  'than',
  'the',
  'to',
  'use',
  'when',
  'with',
]);

function words(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function phrase(value: string): string {
  return words(value).join(' ');
}

function familyFromName(template: string): Family {
  const lower = template.toLowerCase();
  for (const [prefix, family] of FAMILY_PREFIXES) {
    if (lower === prefix || lower.startsWith(`${prefix}-`) || lower.startsWith(`${prefix}__`)) {
      return family;
    }
  }
  if (/^(trend|area|calendar|connected).*?(line|time)|timeline/.test(lower)) {
    return 'time-series';
  }
  if (/scatter|bubble|heatmap/.test(lower)) return 'correlation';
  if (/box|histogram|violin|beeswarm|barcode/.test(lower)) return 'distribution';
  if (/rank|pareto|bump/.test(lower)) return 'ranking';
  if (/pie|treemap|funnel|waterfall|stacked/.test(lower)) return 'part-to-whole';
  if (/map|choropleth|spatial|cartogram/.test(lower)) return 'spatial';
  if (/quota|bullet|kpi/.test(lower)) return 'kpi';
  if (/slope|variance|gain-loss|diverging|deviation|diff/.test(lower)) return 'deviation';
  if (/bar|column|lollipop|radar|gantt/.test(lower)) return 'magnitude';
  return 'specialized';
}

function stem(word: string): string | null {
  if (word.endsWith('ing') && word.length > 5) return word.slice(0, -3);
  if (word.endsWith('ed') && word.length > 4) return word.slice(0, -2);
  return null;
}

function keywordsFromName(template: string, family: Family): string[] {
  const segments = template.split('__').map(phrase).filter(Boolean);
  const tokens = words(template).filter((word) => !TOKEN_STOP_WORDS.has(word));
  const keywords = new Set<string>([phrase(template), phrase(family)]);
  for (const segment of segments) keywords.add(segment);
  for (const token of tokens) {
    keywords.add(token);
    const root = stem(token);
    if (root) keywords.add(root);
  }
  return [...keywords].filter(Boolean);
}

/**
 * Adapt one TBM-derived snapshot to the existing deterministic selector. Every
 * selection fact is recomputed from this snapshot's own bytes and filename; no
 * protected/template sidecar can leak into a user override with the same name.
 */
export function runtimeTemplateDescriptorFromSnapshot(
  snapshot: TemplateRuntimeSnapshot,
): RuntimeTemplateDescriptor {
  const family = familyFromName(snapshot.template);
  const fastPathEligible = snapshot.eligibility.pass1_eligible;
  return {
    ...snapshot.descriptor,
    family,
    fast_path_eligible: fastPathEligible,
    fast_path_blockers: snapshot.eligibility.pass1_blockers.slice(),
    intent_keywords: keywordsFromName(snapshot.template, family),
    description: phrase(snapshot.template),
  };
}

export function loadRuntimeTemplateDescriptors(
  options: TemplateCatalogOptions = {},
): Map<string, RuntimeTemplateDescriptor> {
  return new Map(
    [...loadRuntimeTemplateCatalogSnapshots(options)].map(([template, value]) => [
      template,
      value.descriptor,
    ]),
  );
}

export interface RuntimeTemplateCatalogSnapshot {
  snapshot: TemplateRuntimeSnapshot;
  descriptor: RuntimeTemplateDescriptor;
}

function createSupportedRuntimeSnapshot(
  template: string,
  bookmark: string,
): TemplateRuntimeSnapshot | null {
  try {
    return createTemplateRuntimeSnapshot(template, bookmark);
  } catch {
    return null;
  }
}

export function loadRuntimeTemplateCatalogSnapshots(
  options: TemplateCatalogOptions = {},
): Map<string, RuntimeTemplateCatalogSnapshot> {
  const snapshots = new Map<string, RuntimeTemplateCatalogSnapshot>();
  for (const entry of listTemplateCatalog(options)) {
    if (entry.discoveryIssue) continue;
    const bookmark = readBookmarkFromCatalogEntry(entry, options.operations);
    if (bookmark === null) continue;
    const snapshot = createSupportedRuntimeSnapshot(entry.template, bookmark);
    if (snapshot === null) continue;
    snapshots.set(entry.template, {
      snapshot,
      descriptor: runtimeTemplateDescriptorFromSnapshot(snapshot),
    });
  }
  return snapshots;
}

export function getRuntimeTemplateSnapshot(
  template: string,
  options: TemplateCatalogOptions = {},
): TemplateRuntimeSnapshot | null {
  const entry = listTemplateCatalog(options).find((candidate) => candidate.template === template);
  if (!entry || entry.discoveryIssue) return null;
  const bookmark = readBookmarkFromCatalogEntry(entry, options.operations);
  return bookmark === null ? null : createSupportedRuntimeSnapshot(template, bookmark);
}
