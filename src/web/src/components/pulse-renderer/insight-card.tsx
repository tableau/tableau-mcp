import type { InsightViz } from '@tableau/ntbue-visualization-renderer';

import { ChartWrapper } from './chart-wrapper';
import styles from './insight-card.module.css';

export type InsightCardProps = {
  insightType: string;
  viz: InsightViz;
  question?: string;
  questionPrefix?: string;
  markup?: string;
  chartHeightMultiplier?: number;
};

export function InsightCard({
  insightType,
  viz,
  question,
  questionPrefix,
  markup,
  chartHeightMultiplier = 1,
}: InsightCardProps): React.ReactNode {
  return (
    <div className={styles.insightCardContainer}>
      {question && (
        <div className={styles.questionContainer}>
          {question && (
            <span className={styles.question}>
              <span className={styles.questionPrefix}>{questionPrefix || 'You asked'} | </span>
              {question}
            </span>
          )}
        </div>
      )}
      <div className={styles.insightCard}>
        <div className={styles.inner}>
          {markup && <div className={styles.body} dangerouslySetInnerHTML={{ __html: markup }} />}
          <ChartWrapper
            insightType={insightType}
            spec={viz}
            heightMultiplier={chartHeightMultiplier}
          />
        </div>
      </div>
    </div>
  );
}
