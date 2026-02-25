import type { InsightViz } from '@tableau/ntbue-visualization-renderer';

import { ChartWrapper } from './chart-wrapper';
import styles from './insight-card.module.css';

export type InsightCardProps = {
  insightType: string;
  viz: InsightViz;
  question?: string;
  markup?: string;
};

export function InsightCard({
  insightType,
  viz,
  question,
  markup,
}: InsightCardProps): React.ReactNode {
  return (
    <div className={styles.insightCardContainer}>
      {question && (
        <div className={styles.questionContainer}>
          <span className={styles.question}>{question}</span>
        </div>
      )}
      <div className={styles.insightCard}>
        <div className={styles.inner}>
          {markup && <div className={styles.body} dangerouslySetInnerHTML={{ __html: markup }} />}
          <ChartWrapper insightType={insightType} spec={viz} />
        </div>
      </div>
    </div>
  );
}
