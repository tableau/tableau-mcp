import type { PulseBundleResponse } from '../../../../sdks/tableau/types/pulse';
import styles from './insight-bundle-renderer.module.css';
import { InsightCard } from './insight-card';

type InsightBundleRendererProps = {
  bundle: PulseBundleResponse['bundle_response']['result'];
  insightGroupType: string;
};

export function InsightBundleRenderer({
  bundle,
  insightGroupType,
}: InsightBundleRendererProps): React.ReactNode {
  const insightGroup = bundle?.insight_groups.find((group) => group.type === insightGroupType);
  if (!insightGroup?.insights) {
    return <div className={styles.insightBundleRenderer}>No insights to display.</div>;
  }

  return (
    <div className={styles.insightBundleRenderer}>
      {insightGroup?.insights.map((insight, index) => (
        <div key={`${insight.insight_type}-${index}`}>
          <InsightCard
            insightType={insight.result.type}
            viz={insight.result.viz}
            question={insight.result.question}
            markup={insight.result.markup}
          />
        </div>
      ))}
    </div>
  );
}
