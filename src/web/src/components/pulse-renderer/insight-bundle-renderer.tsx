import type { PulseBundleResponse } from '../../../../sdks/tableau/types/pulse';
import { InsightGroupType } from './enums';
import styles from './insight-bundle-renderer.module.css';
import { InsightCard } from './insight-card';

type InsightBundleRendererProps = {
  bundle: PulseBundleResponse['bundle_response']['result'];
  insightGroupTypes: Set<string>;
};

export function InsightBundleRenderer({
  bundle,
  insightGroupTypes,
}: InsightBundleRendererProps): React.ReactNode {
  const topInsights = bundle?.insight_groups
    .filter(
      (group) => group.type !== InsightGroupType.Followup && insightGroupTypes.has(group.type),
    )
    .flatMap((group) => group.insights);

  let followupInsights: typeof topInsights = [];
  if (insightGroupTypes.has(InsightGroupType.Followup)) {
    followupInsights = bundle?.insight_groups
      .filter((group) => group.type === InsightGroupType.Followup)
      .flatMap((group) => group.insights);
  }

  const nodes: Array<React.ReactNode> = [];
  if (topInsights.length) {
    nodes.push(
      <div key="top-insights" className={styles.insightBundleRenderer}>
        {topInsights.map((insight, index) => (
          <div key={`${insight.insight_type}-${index}`}>
            <InsightCard
              insightType={insight.result.type}
              viz={insight.result.viz}
              question={insight.result.question}
              markup={insight.result.markup}
            />
          </div>
        ))}
      </div>,
    );

    if (followupInsights.length) {
      nodes.push(
        <>
          <div key="followup-insights-header">Follow-up Insights</div>
          <ul>
            {followupInsights.map((insight, index) => (
              <li key={`${insight.insight_type}-${index}`}>{insight.result.question}</li>
            ))}
          </ul>
        </>,
      );
      nodes.push(
        <div key="followup-insights" className={styles.insightBundleRenderer}>
          {followupInsights.map((insight, index) => (
            <div key={`${insight.insight_type}-${index}`}>
              <InsightCard
                insightType={insight.result.type}
                viz={insight.result.viz}
                question={insight.result.question}
                markup={insight.result.markup}
              />
            </div>
          ))}
        </div>,
      );
    }
  }

  if (nodes.length === 0) {
    return <div className={styles.insightBundleRenderer}>No insights to display.</div>;
  }

  return <div className={styles.insightBundleRenderer}>{nodes}</div>;
}
