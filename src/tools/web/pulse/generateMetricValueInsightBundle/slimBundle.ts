import { z } from 'zod';

import {
  MetricContext,
  pulseBundleRequestSchema,
  PulseBundleResponse,
} from '../../../../sdks/tableau/types/pulse.js';

type BundleRequest = z.infer<typeof pulseBundleRequestSchema>;

/**
 * Returns a slimmed-down copy of a `PulseBundleResponse` — the response a text/card UI (e.g.
 * Tableau Studio) actually renders, with the large fields it never reads stripped off to reduce
 * payload size.
 *
 * Today that means removing every `viz` (Vega chart-spec) blob from
 * `insight_groups[].insights[].result` and `insight_groups[].summaries[].result`; the UI renders
 * from `facts`/`markup` alone. This is the single seam for that slimming — as more
 * unused-by-the-UI fields are identified, drop them here so the `slim` tool param keeps meaning
 * "the lean response" without the caller needing to know which fields changed. Does not mutate
 * `bundle`.
 */
export function slimBundle(bundle: PulseBundleResponse): PulseBundleResponse {
  return {
    ...bundle,
    bundle_response: {
      ...bundle.bundle_response,
      result: {
        ...bundle.bundle_response.result,
        insight_groups: bundle.bundle_response.result.insight_groups.map((insightGroup) => ({
          ...insightGroup,
          insights: insightGroup.insights.map((insight) => {
            const { viz: _viz, ...resultWithoutViz } = insight.result;
            return {
              ...insight,
              result: resultWithoutViz,
            };
          }),
          summaries: insightGroup.summaries.map((summary) => {
            const { viz: _viz, ...resultWithoutViz } = summary.result;
            return {
              ...summary,
              result: resultWithoutViz,
            };
          }),
        })),
      },
    },
  };
}

/**
 * Builds the `metric_context` surfaced alongside a slim bundle response — the agent's per-bundle
 * choices, read straight off the `bundleRequest` it called the tool with, so a card UI can read
 * them instead of parsing them out of markup.
 *
 * Provides two tiers: a handful of CURATED flat fields (name/measure/time_dimension/
 * breakdown_dimensions) as the clean primary interface, plus `input` — the request's `input`
 * echoed VERBATIM — as an escape hatch for any request field not (yet) surfaced flat, e.g. the
 * comparison kind at `input.metric.metric_specification.comparison.comparison`. Every curated
 * field this reads is optional in `pulseBundleRequestSchema`, so every access is defensive. Does
 * not mutate `bundleRequest`.
 */
export function buildMetricContext(bundleRequest: BundleRequest): MetricContext {
  const { input } = bundleRequest.bundle_request;

  return {
    name: input.metadata.name,
    measure: input.metric.definition.basic_specification?.measure.field,
    time_dimension: input.metric.definition.basic_specification?.time_dimension.field,
    breakdown_dimensions: input.metric.extension_options?.allowed_dimensions ?? [],
    input,
  };
}
