import { PulseBundleResponse } from '../../../../sdks/tableau/types/pulse.js';

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
