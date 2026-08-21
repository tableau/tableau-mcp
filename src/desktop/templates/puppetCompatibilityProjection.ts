import type { BinderResult } from '../binder/binder.js';
import { escapeXml } from '../binder/escape.js';
import type { RuntimeTemplateDescriptor } from '../binder/manifest-types.js';
import type { SchemaSummary } from '../binder/schema-summary.js';
import { WATERFALL_ANCHOR_FIELD_RE, WATERFALL_TEMPLATE_NAME } from '../binder/waterfall.js';
import type { RuntimeTemplateCatalogSnapshot } from './runtimeTemplateCatalog.js';

export interface PuppetCompatibilityProjection {
  allDescriptors: Map<string, RuntimeTemplateDescriptor>;
  descriptors: Map<string, RuntimeTemplateDescriptor>;
  expandBinderResult(result: BinderResult, schemaSummary?: SchemaSummary): BinderResult;
}

const WATERFALL_ANCHOR_TEMPLATE_FIELD = 'Anchor Category';
const GENERIC_INTENT_WORDS = new Set(['chart', 'plot', 'map']);
// TBM structure cannot distinguish the two-slot bar twins; generic bar keeps the proven puppet default.
const PUPPET_DEFAULT_CHARTS = new Map([['bar-chart', 'ranking-ordered-bar']]);
const AUTOMATIC_NOUN_ALIASES = new Map<string, string[]>([
  ['ranking-ordered-bar', ['bar', 'sorted-bar']],
  ['magnitude-paired-bar', ['grouped-bar', 'grouped-bar-chart', 'paired-bar']],
  ['ranking-ordered-column', ['column', 'sorted-column', 'vertical-bar']],
  ['part-to-whole-stacked-bar-chart', ['stacked-bar']],
  ['part-to-whole-treemap-chart', ['treemap']],
  ['part-to-whole-pie-chart', ['pie']],
  ['correlation-highlight-table', ['heatmap', 'highlight-table']],
  ['correlation-scatter-trendline-chart', ['with-trend-line']],
  ['trend-line-chart', ['line', 'trend', 'over-time', 'timeline']],
  ['gantt-task-rollup-chart', ['gantt']],
  ['distribution-histogram', ['histogram']],
  ['quota-attainment-bullet', ['bullet']],
  ['funnel-chart', ['funnel']],
  ['slope-chart', ['slope', 'slope-chart', 'slope-graph']],
  ['box-plot-chart', ['box-plot', 'boxplot', 'box-and-whisker']],
  ['ww-ou-arrow', ['arrow-chart', 'over-under-arrow']],
  ['distribution-bar-code-chart', ['bar-code', 'strip-plot', 'dot-strip']],
  ['part-to-whole-waterfall', ['waterfall']],
  ['spatial-choropleth-map', ['choropleth', 'filled-map', 'region-map']],
]);
const AUTOMATIC_NOUNS = new Set([...AUTOMATIC_NOUN_ALIASES.values()].flat());

export function preferredAutomaticTemplateForNoun(noun: string): string | undefined {
  const normalized = noun.trim().toLowerCase().replace(/\s+/g, '-');
  for (const [template, aliases] of AUTOMATIC_NOUN_ALIASES) {
    if (aliases.includes(normalized)) return template;
  }
  return undefined;
}

function filenameIntentKeywords(template: string): string[] {
  const tokens = new Set(
    template
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean),
  );
  const keywords: string[] = [];
  if (tokens.has('scatterplot')) keywords.push('scatterplot');
  if (tokens.has('connected') && tokens.has('scatterplot')) {
    keywords.push('connected-scatterplot');
  }
  if (tokens.has('scatter') && tokens.has('plot')) keywords.push('scatter', 'scatter-plot');
  if (tokens.has('choropleth')) keywords.push('choropleth', 'filled-map', 'region-map');
  if (tokens.has('symbol') && tokens.has('map')) keywords.push('symbol-map');
  for (const [keyword, defaultTemplate] of PUPPET_DEFAULT_CHARTS) {
    if (template === defaultTemplate) keywords.push(keyword);
  }
  return keywords;
}

function normalizeRequiredSlots(descriptor: RuntimeTemplateDescriptor): RuntimeTemplateDescriptor {
  if (
    descriptor.template !== 'correlation-highlight-table' &&
    descriptor.template !== 'quota-attainment-bullet' &&
    descriptor.template !== 'correlation-bubble-chart'
  ) {
    return descriptor;
  }
  return {
    ...descriptor,
    slots: descriptor.slots.map((slot) =>
      slot.kind === 'quantitative' &&
      ((descriptor.template === 'correlation-highlight-table' && slot.role.includes('color')) ||
        (descriptor.template === 'quota-attainment-bullet' &&
          slot.role.includes('reference-line') &&
          !slot.role.includes('cols')) ||
        (descriptor.template === 'correlation-bubble-chart' && slot.role.includes('size')))
        ? { ...slot, required: true }
        : slot,
    ),
  };
}

function automaticDescriptor(descriptor: RuntimeTemplateDescriptor): RuntimeTemplateDescriptor {
  const normalized = normalizeRequiredSlots(descriptor);
  return {
    ...normalized,
    intent_keywords: [
      ...new Set([
        ...normalized.intent_keywords.filter(
          (keyword) =>
            (!GENERIC_INTENT_WORDS.has(keyword.toLowerCase()) || descriptor.family === 'spatial') &&
            !AUTOMATIC_NOUNS.has(keyword.toLowerCase()),
        ),
        ...(AUTOMATIC_NOUN_ALIASES.get(normalized.template) ?? []),
        ...(normalized.family === 'correlation' ? ['scatter-plot', 'scatterplot'] : []),
        ...filenameIntentKeywords(normalized.template),
      ]),
    ],
  };
}

function bareColumnName(columnName: string): string {
  return columnName.replace(/^\[|\]$/g, '');
}

function withWaterfallAnchorDefault(
  result: Extract<BinderResult, { status: 'bound' }>,
  schemaSummary: SchemaSummary | undefined,
): Extract<BinderResult, { status: 'bound' }> {
  if (
    result.args.template_name !== WATERFALL_TEMPLATE_NAME ||
    schemaSummary === undefined ||
    result.args.field_mapping[WATERFALL_ANCHOR_TEMPLATE_FIELD] !== undefined
  ) {
    return result;
  }
  const anchor = schemaSummary.fields.find(
    (field) => field.role === 'dimension' && WATERFALL_ANCHOR_FIELD_RE.test(field.name),
  );
  if (!anchor) return result;
  const suffix = anchor.type === 'ordinal' ? 'ok' : 'nk';
  const mapping = escapeXml(
    `[${anchor.datasource}].[none:${bareColumnName(anchor.columnName)}:${suffix}]`,
  );
  return {
    ...result,
    args: {
      ...result.args,
      field_mapping: {
        ...result.args.field_mapping,
        [WATERFALL_ANCHOR_TEMPLATE_FIELD]: mapping,
      },
    },
    warnings: [
      ...(result.warnings ?? []),
      `auto-bound anchor_category to "${anchor.name}" to exclude subtotal and total rows when present`,
    ],
  };
}

export function createPuppetCompatibilityProjection(
  runtimeCatalog: ReadonlyMap<string, RuntimeTemplateCatalogSnapshot>,
): PuppetCompatibilityProjection {
  const allDescriptors = new Map(
    [...runtimeCatalog].map(([template, value]) => [
      template,
      normalizeRequiredSlots(value.descriptor),
    ]),
  );
  const descriptors = new Map(
    [...runtimeCatalog]
      .filter(([template]) => !template.includes('__'))
      .map(([template, value]) => [template, automaticDescriptor(value.descriptor)]),
  );

  return {
    allDescriptors,
    descriptors,
    expandBinderResult: (result, schemaSummary) =>
      result.status === 'bound' ? withWaterfallAnchorDefault(result, schemaSummary) : result,
  };
}
