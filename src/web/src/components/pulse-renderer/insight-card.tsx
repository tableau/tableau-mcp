import type { PulseInsight } from '../../../../sdks/tableau/types/pulse';
import { ChartWrapper } from './chart-wrapper';
import styles from './insight-card.module.css';

export type InsightCardProps = {
  insight: PulseInsight;
};

export function InsightCard({ insight }: InsightCardProps): React.ReactNode {
  return (
    <div className={styles.insightCardContainer}>
      <div className={styles.questionContainer}>
        <span className={styles.question}>{insight.question}</span>
      </div>
      <div className={styles.insightCard}>
        <div className={styles.inner}>
          <div className={styles.body} dangerouslySetInnerHTML={{ __html: insight.markup ?? '' }} />
          <ChartWrapper insightType={insight.type} spec={insight.viz} />
        </div>
      </div>
    </div>
  );
}
