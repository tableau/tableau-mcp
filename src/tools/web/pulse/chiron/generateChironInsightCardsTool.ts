import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { ArgsValidationError, FeatureDisabledError } from '../../../../errors/mcpToolError.js';
import { useRestApi } from '../../../../restApiInstance.js';
import {
  pulseBundleRequestSchema,
  PulseBundleResponse,
} from '../../../../sdks/tableau/types/pulse.js';
import { WebMcpServer } from '../../../../server.web.js';
import { getVizqlDataServiceDisabledError } from '../../getVizqlDataServiceDisabledError.js';
import { WebTool } from '../../tool.js';
import { buildChironBundleRequest } from './requestBuilder.js';
import { runChironBundle } from './runChironBundle.js';

type InsightDirection = 'up' | 'down' | 'flat' | 'no_data';

const CHIRON_BUNDLE_TYPE = 'detail' as const;

type SeriesPoint = {
  date: string;
  label: string;
  value: number | null;
  lower: number | null;
  upper: number | null;
  dashed: boolean;
};

type BreakdownItem = {
  label: string;
  value: number;
};

type PeriodValue = {
  label: string;
  subLabel: string;
  value: number;
  formatted: string;
};

type PeriodComparison = {
  current: PeriodValue;
  prior: PeriodValue;
};

// TOP CONTRIBUTING FACTORS: a dimension member + its raw contribution and the
// share of the total swing it accounts for (the "% of lift" in the mockup).
type Contributor = {
  label: string;
  value: number;
  formatted: string;
  sharePct: number | null;
};

// WHERE IT'S MOST / LEAST PRONOUNCED: a single dimension member and its own
// period-over-period change (not its contribution to the aggregate).
type Extreme = {
  label: string;
  value: number;
  formatted: string;
};

type Pronounced = {
  strongest: Extreme;
  weakest: Extreme;
};

// WHAT'S UNUSUAL: the anomaly/unusual-change insight text plus the numeric
// deviation from the baseline when Pulse provides it.
type UnusualInsight = {
  text: string;
  factor: number | null;
  baselineWindow: string | null;
};

// AVAILABLE ACTIONS: app-defined buttons the UI renders under the card. These
// are the only non-governed part of the payload (labels, not data).
type InsightAction = {
  id: string;
  label: string;
  primary: boolean;
};

const DEFAULT_ACTIONS: InsightAction[] = [
  { id: 'drill', label: 'Drill into this', primary: true },
  { id: 'filter-top-driver', label: 'Filter to top driver', primary: false },
  { id: 'build-viz', label: 'Build a viz from this', primary: false },
];

type InsightCard = {
  id: string;
  measure: string;
  timeField: string;
  label: string;
  headline: string;
  deltaPct: number | null;
  direction: InsightDirection;
  explanation: string;
  // Block 2 in the detail mockup: "3× the trailing average of +4%".
  context: string | null;
  comparison: PeriodComparison | null;
  series: SeriesPoint[];
  breakdown: BreakdownItem[];
  // The primary dimension the contributors belong to, so the UI can build
  // member-filter drills ("what's driving <member>?"). Best-effort: the first
  // allowed dimension sent to Pulse for this card.
  breakdownDimension: string | null;
  // Block 3: TOP CONTRIBUTING FACTORS (breakdown + share of lift).
  contributors: Contributor[];
  // Block 4: WHERE IT'S MOST / LEAST PRONOUNCED.
  pronounced: Pronounced | null;
  // Block 5: WHAT'S UNUSUAL.
  unusual: UnusualInsight | null;
  // Block 6: SUGGESTED FOLLOW-UPS (generated from drivers + dimensions).
  followUps: string[];
  // Block 7: AVAILABLE ACTIONS (static button set).
  actions: InsightAction[];
  provenance: 'governed';
  briefConfig: {
    tool: 'generate-pulse-metric-value-insight-bundle';
    args: {
      bundleRequest: z.infer<typeof pulseBundleRequestSchema>;
      bundleType: typeof CHIRON_BUNDLE_TYPE;
    };
  };
};

const paramsSchema = {
  datasource: z.union([z.string().nonempty(), z.object({ luid: z.string().nonempty() })]),
  measures: z.array(z.string().nonempty()).optional(),
  timeField: z.string().nonempty().optional(),
  maxCards: z.number().int().positive().max(10).optional(),
  // Drill-down controls. `breakdownDimension` scopes the breakdown group to a
  // single dimension; `filters` restrict the metric to specific members.
  breakdownDimension: z.string().nonempty().optional(),
  filters: z
    .array(z.object({ field: z.string().nonempty(), value: z.string() }))
    .optional(),
};

export const getGenerateChironInsightCardsTool = (
  server: WebMcpServer,
): WebTool<typeof paramsSchema> => {
  const tool = new WebTool({
    server,
    name: 'generate-chiron-insight-cards',
    description:
      'Generate deterministic period-over-period insight cards for a datasource using Pulse bundle insights.',
    paramsSchema,
    annotations: {
      title: 'Generate Chiron Insight Cards',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    callback: async (
      { datasource, measures, timeField, maxCards, breakdownDimension, filters },
      extra,
    ): Promise<CallToolResult> => {
      return await tool.logAndExecute({
        extra,
        args: { datasource, measures, timeField, maxCards, breakdownDimension, filters },
        callback: async () => {
          const cardLimit = maxCards ?? 4;
          return await useRestApi({
            ...extra,
            jwtScopes: tool.requiredApiScopes,
            callback: async (restApi) => {
              const resolved = await resolveDatasource({
                restApi,
                datasource,
              });
              if (!resolved) {
                return new ArgsValidationError(
                  'Could not resolve datasource from provided input',
                ).toErr();
              }

              const metadataResult = await restApi.vizqlDataServiceMethods.readMetadata({
                datasource: { datasourceLuid: resolved.luid },
              });
              if (metadataResult.isErr()) {
                return new FeatureDisabledError(getVizqlDataServiceDisabledError()).toErr();
              }

              const selectedTimeField = pickTimeField(metadataResult.value.data ?? [], timeField);
              if (!selectedTimeField) {
                return new ArgsValidationError(
                  'Could not determine a DATE/DATETIME time field for this datasource',
                ).toErr();
              }

              const selectedMeasures = pickMeasures(
                metadataResult.value.data ?? [],
                measures,
                cardLimit,
              );
              if (selectedMeasures.length === 0) {
                return new ArgsValidationError(
                  'Could not determine numeric measures for this datasource',
                ).toErr();
              }

              // The full set of categorical dimensions is always returned to the
              // client so every (including drilled) insight can propose fresh
              // "break down by <other dimension>" follow-ups. A drill request
              // only narrows the *active* set used for this bundle's breakdown.
              const allDimensions = pickDimensions(metadataResult.value.data ?? []);
              const activeDimensions = breakdownDimension ? [breakdownDimension] : allDimensions;
              const primaryDimension = activeDimensions[0] ?? null;

              const cards: InsightCard[] = [];
              for (const measure of selectedMeasures) {
                const request = buildChironBundleRequest({
                  datasourceLuid: resolved.luid,
                  datasourceName: resolved.name,
                  measure,
                  timeField: selectedTimeField,
                  allowedDimensions: activeDimensions,
                  filters,
                });
                const bundle = await runChironBundle({
                  extra,
                  request,
                  bundleType: CHIRON_BUNDLE_TYPE,
                  jwtScopes: tool.requiredApiScopes,
                });
                if (bundle.isErr()) {
                  continue;
                }

                cards.push(
                  mapBundleToCard({
                    datasourceLuid: resolved.luid,
                    measure,
                    timeField: selectedTimeField,
                    dimensions: allDimensions,
                    primaryDimension,
                    bundleResponse: bundle.value as PulseBundleResponse,
                    bundleRequest: request,
                  }),
                );
              }

              return Ok({
                datasource: {
                  luid: resolved.luid,
                  contentUrl: resolved.contentUrl,
                  name: resolved.name,
                },
                dimensions: allDimensions,
                cards,
                generatedAt: new Date().toISOString(),
              });
            },
          });
        },
        constrainSuccessResult: (result) => ({ type: 'success', result }),
      });
    },
  });

  return tool;
};

function pickTimeField(fields: Array<Record<string, unknown>>, override?: string): string | null {
  if (override) {
    return override;
  }
  const field = fields.find(
    (item) =>
      typeof item.fieldCaption === 'string' &&
      (item.dataType === 'DATE' || item.dataType === 'DATETIME'),
  );
  return typeof field?.fieldCaption === 'string' ? field.fieldCaption : null;
}

function pickMeasures(
  fields: Array<Record<string, unknown>>,
  overrides: Array<string> | undefined,
  maxCards: number,
): string[] {
  if (overrides?.length) {
    return overrides.slice(0, maxCards);
  }
  const measures = fields
    .filter(
      (item) =>
        typeof item.fieldCaption === 'string' &&
        (item.dataType === 'INTEGER' || item.dataType === 'REAL'),
    )
    .map((item) => item.fieldCaption as string);
  return Array.from(new Set(measures)).slice(0, maxCards);
}

// Categorical (STRING) fields are candidates for Pulse dimension breakdowns.
// Without allowed_dimensions the detail bundle's breakdown group is empty.
function pickDimensions(fields: Array<Record<string, unknown>>, max = 5): string[] {
  const dimensions = fields
    .filter((item) => typeof item.fieldCaption === 'string' && item.dataType === 'STRING')
    .map((item) => item.fieldCaption as string);
  return Array.from(new Set(dimensions)).slice(0, max);
}

async function resolveDatasource({
  restApi,
  datasource,
}: {
  restApi: {
    datasourcesMethods: {
      listDatasources: (args: {
        siteId: string;
        filter: string;
        pageSize: number;
        pageNumber: number;
      }) => Promise<{ datasources: Array<{ id: string; name: string; contentUrl?: string }> }>;
    };
    siteId: string;
  };
  datasource: string | { luid: string };
}): Promise<{ luid: string; name: string; contentUrl: string } | null> {
  if (typeof datasource !== 'string') {
    return { luid: datasource.luid, name: datasource.luid, contentUrl: datasource.luid };
  }

  const response = await restApi.datasourcesMethods.listDatasources({
    siteId: restApi.siteId,
    filter: `contentUrl:eq:${datasource}`,
    pageSize: 100,
    pageNumber: 1,
  });
  const exactMatch = response.datasources.find((d) => d.contentUrl === datasource);
  if (!exactMatch) {
    return null;
  }

  return {
    luid: exactMatch.id,
    name: exactMatch.name,
    contentUrl: exactMatch.contentUrl ?? datasource,
  };
}

function mapBundleToCard({
  datasourceLuid,
  measure,
  timeField,
  dimensions,
  primaryDimension,
  bundleResponse,
  bundleRequest,
}: {
  datasourceLuid: string;
  measure: string;
  timeField: string;
  dimensions: string[];
  primaryDimension: string | null;
  bundleResponse: PulseBundleResponse;
  bundleRequest: z.infer<typeof pulseBundleRequestSchema>;
}): InsightCard {
  const popcInsight = bundleResponse.bundle_response.result.insight_groups
    .flatMap((group) => group.insights)
    .find((insight) => insight.insight_type.toLowerCase().includes('popc'));

  const markup = popcInsight?.result.markup ?? '';
  const parsed = parseFactsAndMarkup(popcInsight?.result.facts, markup);
  const contributors = extractContributors(bundleResponse);

  return {
    id: `${datasourceLuid}:${measure}:trend`,
    measure,
    timeField,
    label: `${measure} vs prior period`,
    headline: parsed.headline,
    deltaPct: parsed.deltaPct,
    direction: parsed.direction,
    explanation: markup || 'No insight text available',
    context: extractContext(popcInsight?.result.facts),
    comparison: extractComparison(popcInsight?.result.facts),
    series: extractSeries(bundleResponse),
    breakdown: contributors.map(({ label, value }) => ({ label, value })),
    breakdownDimension: primaryDimension,
    contributors,
    pronounced: extractPronounced(bundleResponse),
    unusual: extractUnusual(bundleResponse),
    followUps: buildFollowUps({ contributors, dimensions }),
    actions: DEFAULT_ACTIONS,
    provenance: 'governed',
    briefConfig: {
      tool: 'generate-pulse-metric-value-insight-bundle',
      args: {
        bundleRequest,
        bundleType: CHIRON_BUNDLE_TYPE,
      },
    },
  };
}

type VizCarrier = { result?: { viz?: unknown } };

function collectVizValues(bundleResponse: PulseBundleResponse): unknown[][] {
  const arrays: unknown[][] = [];
  for (const group of bundleResponse.bundle_response.result.insight_groups) {
    const carriers: VizCarrier[] = [
      ...(group.insights ?? []),
      ...(group.summaries ?? []),
    ];
    for (const carrier of carriers) {
      const values = readVizValues(carrier.result?.viz);
      if (values) {
        arrays.push(values);
      }
    }
  }
  return arrays;
}

function readVizValues(viz: unknown): unknown[] | null {
  if (viz && typeof viz === 'object') {
    const data = (viz as { data?: unknown }).data;
    if (data && typeof data === 'object') {
      const values = (data as { values?: unknown }).values;
      if (Array.isArray(values)) {
        return values;
      }
    }
  }
  return null;
}

// The detail bundle's anchor group carries a per-period time series in
// viz.data.values (truncDate + rawValue + ci0/ci1 normal-range band).
function extractSeries(bundleResponse: PulseBundleResponse): SeriesPoint[] {
  for (const values of collectVizValues(bundleResponse)) {
    const looksLikeSeries = values.some(
      (row) => row && typeof row === 'object' && 'truncDate' in (row as Record<string, unknown>),
    );
    if (!looksLikeSeries) {
      continue;
    }
    const points = values
      .map((row) => row as Record<string, unknown>)
      .map((row) => ({
        date: typeof row.truncDate === 'string' ? row.truncDate : '',
        label: typeof row.formattedTruncDate === 'string' ? row.formattedTruncDate : '',
        value: coerceNum(row.rawValue),
        lower: coerceNum(row.ci0),
        upper: coerceNum(row.ci1),
        dashed: Boolean(row.dashed),
      }))
      .filter((point) => point.date !== '')
      // Pulse returns points newest-first; sort ascending so charts read left→right.
      .sort((a, b) => a.date.localeCompare(b.date));
    if (points.length > 0) {
      return points;
    }
  }
  return [];
}

// The detail bundle's breakdown group carries top-contributor bars per
// filterable dimension. Shape varies, so detect a string label + numeric value,
// then compute each member's share of the total swing ("% of lift").
function extractContributors(bundleResponse: PulseBundleResponse): Contributor[] {
  const breakdownGroup = bundleResponse.bundle_response.result.insight_groups.find(
    (group) => group.type === 'breakdown',
  );
  if (!breakdownGroup) {
    return [];
  }
  for (const insight of breakdownGroup.insights ?? []) {
    const values = readVizValues((insight as VizCarrier).result?.viz);
    if (!values || values.length === 0) {
      continue;
    }
    const rows = values.filter(isRecord);
    const sample = rows[0] ?? {};
    const keys = Object.keys(sample);
    const valueKey =
      keys.find((k) => typeof sample[k] === 'number' && /val|value|measure|count|total/i.test(k)) ??
      keys.find((k) => typeof sample[k] === 'number');
    const labelKey =
      keys.find(
        (k) =>
          typeof sample[k] === 'string' &&
          /name|label|dim|category|member|caption|contributor/i.test(k),
      ) ?? keys.find((k) => typeof sample[k] === 'string');
    const formattedKey = keys.find(
      (k) => typeof sample[k] === 'string' && /formatted/i.test(k),
    );
    if (!valueKey || !labelKey) {
      continue;
    }
    const items = rows
      .map((row) => ({
        label: typeof row[labelKey] === 'string' ? (row[labelKey] as string) : '',
        value: coerceNum(row[valueKey]),
        formatted:
          formattedKey && typeof row[formattedKey] === 'string'
            ? (row[formattedKey] as string)
            : null,
      }))
      .filter((item): item is { label: string; value: number; formatted: string | null } =>
        item.label !== '' && item.value !== null,
      )
      .slice(0, 6);
    if (items.length === 0) {
      continue;
    }
    const total = items.reduce((sum, item) => sum + Math.abs(item.value), 0);
    return items.map((item) => ({
      label: item.label,
      value: item.value,
      formatted: item.formatted ?? `${item.value}`,
      sharePct: total > 0 ? Math.round((Math.abs(item.value) / total) * 100) : null,
    }));
  }
  return [];
}

// WHERE IT'S MOST / LEAST PRONOUNCED: scan viz value arrays for rows carrying a
// per-member percentage/delta field, then pick the strongest and weakest member.
function extractPronounced(bundleResponse: PulseBundleResponse): Pronounced | null {
  for (const values of collectVizValues(bundleResponse)) {
    const rows = values.filter(isRecord);
    const sample = rows[0] ?? {};
    const keys = Object.keys(sample);
    const pctKey = keys.find(
      (k) => typeof sample[k] === 'number' && /percent|delta|change|pct/i.test(k),
    );
    const labelKey =
      keys.find(
        (k) =>
          typeof sample[k] === 'string' && /name|label|dim|category|member|caption/i.test(k),
      ) ?? keys.find((k) => typeof sample[k] === 'string');
    if (!pctKey || !labelKey) {
      continue;
    }
    const formattedKey = keys.find(
      (k) => typeof sample[k] === 'string' && /formatted/i.test(k),
    );
    const members = rows
      .map((row) => ({
        label: typeof row[labelKey] === 'string' ? (row[labelKey] as string) : '',
        value: coerceNum(row[pctKey]),
        formatted:
          formattedKey && typeof row[formattedKey] === 'string'
            ? (row[formattedKey] as string)
            : null,
      }))
      .filter((m): m is { label: string; value: number; formatted: string | null } =>
        m.label !== '' && m.value !== null,
      );
    if (members.length === 0) {
      continue;
    }
    const sorted = [...members].sort((a, b) => b.value - a.value);
    const toExtreme = (m: { label: string; value: number; formatted: string | null }): Extreme => ({
      label: m.label,
      value: m.value,
      formatted: m.formatted ?? formatSignedPct(m.value),
    });
    return {
      strongest: toExtreme(sorted[0]),
      weakest: toExtreme(sorted[sorted.length - 1]),
    };
  }
  return null;
}

// WHAT'S UNUSUAL: the anomaly / unusual-change insight text plus, when present,
// the numeric deviation factor and baseline window from its facts.
function extractUnusual(bundleResponse: PulseBundleResponse): UnusualInsight | null {
  const insight = bundleResponse.bundle_response.result.insight_groups
    .flatMap((group) => group.insights ?? [])
    .find((i) => /unusual|anomaly/i.test(i.insight_type));
  const text = insight?.result.markup ?? '';
  if (!text) {
    return null;
  }
  const facts = insight?.result.facts;
  const record = isRecord(facts) ? facts : {};
  const baselineWindow =
    typeof record.baseline_window === 'string'
      ? record.baseline_window
      : typeof record.baseline === 'string'
        ? record.baseline
        : null;
  return {
    text,
    factor: coerceNum(record.deviation_factor ?? record.factor ?? record.std_devs),
    baselineWindow,
  };
}

// Block 2: "3× the trailing average of +4%". Built from popc facts when Pulse
// exposes the relative-to-average ratio and typical change; otherwise null.
function extractContext(facts: unknown): string | null {
  const record = isRecord(facts) ? facts : {};
  const ratio = coerceNum(record.relative_to_average ?? record.average_multiple);
  const typical = coerceNum(record.typical_delta_percent ?? record.average_delta_percent);
  if (ratio !== null && typical !== null) {
    return `${ratio}× the trailing average of ${formatSignedPct(typical)}`;
  }
  const formatted = record.average_comparison ?? record.context;
  return typeof formatted === 'string' && formatted !== '' ? formatted : null;
}

// Block 6: SUGGESTED FOLLOW-UPS. Deterministic prompts derived from the top
// driver and the datasource's categorical dimensions (not from Pulse).
function buildFollowUps({
  contributors,
  dimensions,
}: {
  contributors: Contributor[];
  dimensions: string[];
}): string[] {
  const followUps: string[] = [];
  const topDriver = contributors[0]?.label;
  if (topDriver) {
    followUps.push(`What's driving ${topDriver}?`);
  }
  if (dimensions[0]) {
    followUps.push(`Compare across ${dimensions[0]}`);
  }
  if (dimensions[1]) {
    followUps.push(`Break down by ${dimensions[1]}`);
  }
  return followUps;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function formatSignedPct(value: number): string {
  return `${value > 0 ? '+' : ''}${value}%`;
}

// The popc insight's facts hold the exact period-over-period comparison that the
// insight text describes: target (current) vs comparison (prior) period values +
// their time-period labels.
function extractComparison(facts: unknown): PeriodComparison | null {
  if (!facts || typeof facts !== 'object') {
    return null;
  }
  const record = facts as Record<string, unknown>;
  const current = readPeriodValue(record.target_period_value, record.target_time_period);
  const prior = readPeriodValue(record.comparison_period_value, record.comparison_time_period);
  if (!current || !prior) {
    return null;
  }
  return { current, prior };
}

function readPeriodValue(valueObj: unknown, timeObj: unknown): PeriodValue | null {
  const valueRecord =
    valueObj && typeof valueObj === 'object' ? (valueObj as Record<string, unknown>) : {};
  const timeRecord =
    timeObj && typeof timeObj === 'object' ? (timeObj as Record<string, unknown>) : {};
  const value = coerceNum(valueRecord.raw);
  if (value === null) {
    return null;
  }
  return {
    label: typeof timeRecord.label === 'string' ? timeRecord.label : '',
    subLabel: typeof timeRecord.range === 'string' ? timeRecord.range : '',
    value,
    formatted: typeof valueRecord.formatted === 'string' ? valueRecord.formatted : `${value}`,
  };
}

function coerceNum(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '' || trimmed.toLowerCase() === 'null') {
      return null;
    }
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function parseFactsAndMarkup(
  facts: unknown,
  markup: string,
): { headline: string; deltaPct: number | null; direction: InsightDirection } {
  const noData = markup.toLowerCase().includes('no data');
  if (noData) {
    return { headline: 'No data', deltaPct: null, direction: 'no_data' };
  }

  const factsRecord = facts && typeof facts === 'object' ? (facts as Record<string, unknown>) : {};
  const headline =
    stringifyFact(
      factsRecord.formatted_current_value ??
        factsRecord.current_value_formatted ??
        factsRecord.current_value,
    ) || extractHeadlineFromMarkup(markup);
  const deltaPct = toNumber(
    factsRecord.delta_percent ??
      factsRecord.period_over_period_change_percent ??
      factsRecord.change_percent,
  );
  const parsedDelta = deltaPct ?? extractDeltaPercentFromMarkup(markup);
  const direction: InsightDirection =
    parsedDelta == null ? 'flat' : parsedDelta > 0 ? 'up' : parsedDelta < 0 ? 'down' : 'flat';

  return { headline: headline || 'N/A', deltaPct: parsedDelta, direction };
}

function stringifyFact(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number') {
    return `${value}`;
  }
  return '';
}

function extractHeadlineFromMarkup(markup: string): string {
  const match = markup.match(/([0-9]+(?:\.[0-9]+)?[KMB%]?)/);
  return match?.[1] ?? '';
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string') {
    const clean = value.replace('%', '').trim();
    const parsed = Number(clean);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function extractDeltaPercentFromMarkup(markup: string): number | null {
  const trendMatch = markup.match(/\b(up|down)\s+([0-9]+(?:\.[0-9]+)?)%/i);
  if (trendMatch) {
    const raw = Number(trendMatch[2]);
    if (!Number.isFinite(raw)) {
      return null;
    }
    return trendMatch[1].toLowerCase() === 'down' ? -raw : raw;
  }
  const signedMatch = markup.match(/([+-]?[0-9]+(?:\.[0-9]+)?)%/);
  if (signedMatch) {
    const raw = Number(signedMatch[1]);
    return Number.isFinite(raw) ? raw : null;
  }
  return null;
}
