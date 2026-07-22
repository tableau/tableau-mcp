import fs from 'fs';
import path from 'path';

import { loadManifests } from '../binder/manifest.js';
import type { TemplateManifest } from '../binder/manifest-types.js';
import { findDonorVocabularyInMigratedExamples } from './templatePlaceholderLint.js';

const XML_DIR = path.join(
  process.cwd(),
  'src',
  'desktop',
  'data',
  'data-visualization-templates-xml',
);

// Migration debt ledger. Every bundled XML must either satisfy the placeholder
// contract or appear here. This set only shrinks as waves land.
const UNMIGRATED_TEMPLATE_GRANDFATHER = new Set([
  'box-plot-chart',
  'bullet-variance-chart',
  'change-over-time-area-chart',
  'change-over-time-calendar-heatmap',
  'change-over-time-stacked-area-chart',
  'connected-scatterplot',
  'control-chart-xmr',
  'correlation-bubble-chart',
  'correlation-dual-axis-chart',
  'correlation-highlight-table',
  'correlation-scatter-plot-chart',
  'deviation-arrow',
  'deviation-gain-loss-chart',
  'deviation-spine-chart',
  'distribution-bar-code-chart',
  'distribution-histogram',
  'funnel-chart',
  'gantt-chart',
  'gantt-task-rollup-chart',
  'gantt-timeline-chart',
  'kpi-text',
  'magnitude-paired-bar',
  'magnitude-paired-column-chart',
  'magnitude-simple-bar',
  'pareto-chart',
  'part-to-whole-pie-chart',
  'part-to-whole-proportional-stacked-bar',
  'part-to-whole-stacked-bar-chart',
  'part-to-whole-treemap-chart',
  'part-to-whole-waterfall',
  'part-to-whole-waterfall-chart',
  'quota-attainment-bullet',
  'ranking-bullet-chart',
  'ranking-bump-chart',
  'ranking-dot-strip-plot',
  'ranking-ordered-column',
  'slope-chart',
  'spatial-choropleth-map',
  'spatial-filled-map',
  'spatial-symbol-map',
  'spatial-symbol-map-latlon',
  'ww-floating-bars',
  'ww-ou-arrow',
  'ww-ou-diff',
]);

const FIELD_PLACEHOLDER_RE = /^\{\{field_base_[1-9]\d*\}\}$/;
const ROLE_MARKERS = new Set(['nk', 'ok', 'qk']);

function fieldFromBracketToken(token: string): string {
  const parts = token.split(':');
  for (let i = parts.length - 1; i >= 1; i--) {
    if (ROLE_MARKERS.has(parts[i])) return parts[i - 1];
  }
  return token;
}

describe('template placeholder lint', () => {
  const xmlTemplates = fs
    .readdirSync(XML_DIR)
    .filter((file) => file.endsWith('.xml'))
    .map((file) => file.replace(/\.xml$/, ''))
    .sort();
  const manifests = loadManifests();
  const migrated = xmlTemplates.filter((name) => !UNMIGRATED_TEMPLATE_GRANDFATHER.has(name));

  it('accounts for the full corpus with a shrinking grandfather list', () => {
    expect(xmlTemplates).toHaveLength(47);
    expect(UNMIGRATED_TEMPLATE_GRANDFATHER.size).toBe(44);
    expect(migrated).toEqual([
      'deviation-diverging-bar',
      'ranking-ordered-bar',
      'trend-line-chart',
    ]);
    for (const name of UNMIGRATED_TEMPLATE_GRANDFATHER) {
      expect(xmlTemplates, `stale grandfather entry '${name}'`).toContain(name);
    }
  });

  it.each(migrated)('%s uses explicit placeholders for every bindable field', (name) => {
    const manifest = manifests.get(name);
    expect(manifest, `${name}: migrated template needs a manifest`).toBeDefined();
    if (!manifest) return;

    const xml = fs.readFileSync(path.join(XML_DIR, `${name}.xml`), 'utf8');
    for (const slot of manifest.slots.filter((candidate) => candidate.bindable)) {
      expect(
        FIELD_PLACEHOLDER_RE.test(slot.template_field),
        `${name}:${slot.slot_id} template_field '${slot.template_field}' is concrete`,
      ).toBe(true);
      expect(
        slot.purpose?.trim().length,
        `${name}:${slot.slot_id} needs semantic purpose metadata`,
      ).toBeGreaterThan(0);
      expect(
        xml.includes(`[${slot.template_field}]`) || xml.includes(`:${slot.template_field}:`),
        `${name}:${slot.slot_id} placeholder is absent from XML`,
      ).toBe(true);
    }
  });

  it.each(migrated)('%s contains no concrete donor field token', (name) => {
    const manifest = manifests.get(name)!;
    const xml = fs.readFileSync(path.join(XML_DIR, `${name}.xml`), 'utf8');
    const templateOwned = new Set(
      [...manifest.slots.filter((slot) => !slot.bindable), ...manifest.calcs].map(
        (slot) => slot.template_field,
      ),
    );
    const offenders = new Set<string>();

    for (const match of xml.matchAll(/\[([^\]]+)\]/g)) {
      const token = match[1];
      if (token === '{{DATASOURCE}}' || token.startsWith(':')) continue;
      const field = fieldFromBracketToken(token);
      if (FIELD_PLACEHOLDER_RE.test(field) || templateOwned.has(field)) continue;
      offenders.add(field);
    }

    expect(
      [...offenders].sort(),
      `${name}: concrete donor field tokens must become {{field_base_N}}`,
    ).toEqual([]);
  });

  it('migrated pilot examples contain no donor vocabulary', () => {
    expect(findDonorVocabularyInMigratedExamples(manifests, migrated)).toEqual([]);
  });

  it('rejects donor vocabulary in migrated pilot examples only', () => {
    const cloned = new Map<string, TemplateManifest>();
    for (const [name, manifest] of manifests) {
      cloned.set(name, structuredClone(manifest));
    }
    cloned.get('ranking-ordered-bar')!.slots[0].examples = ['Country', 'Region'];

    expect(findDonorVocabularyInMigratedExamples(cloned, migrated)).toEqual([
      'ranking-ordered-bar:region example "Region" contains donor vocabulary "Region"',
    ]);

    const grandfathered = structuredClone(manifests.get('part-to-whole-waterfall')!);
    grandfathered.slots[0].examples = ['Sales'];
    cloned.set('part-to-whole-waterfall', grandfathered);
    expect(findDonorVocabularyInMigratedExamples(cloned, migrated)).toEqual([
      'ranking-ordered-bar:region example "Region" contains donor vocabulary "Region"',
    ]);
  });
});
