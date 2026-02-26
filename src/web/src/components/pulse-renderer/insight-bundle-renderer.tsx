import { useRef, useState } from 'react';

import type { PulseBundleResponse } from '../../../../sdks/tableau/types/pulse';
import { InsightGroupType } from './enums';
import styles from './insight-bundle-renderer.module.css';
import { InsightCard } from './insight-card';
import { QuestionChip } from './question-chip';

type InsightBundleRendererProps = {
  bundle: PulseBundleResponse['bundle_response']['result'];
  insightGroupTypes: Set<string>;
};

export function InsightBundleRenderer({
  bundle,
  insightGroupTypes,
}: InsightBundleRendererProps): React.ReactNode {
  const [dismissedChipIndices, setDismissedChipIndices] = useState<Set<number>>(new Set());
  const [visibleFollowupInsightOrder, setVisibleFollowupInsightOrder] = useState<number[]>([]);
  const topFollowupCardRef = useRef<HTMLDivElement | null>(null);

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
      <div key="top-insights">
        <h2 className={styles.title}>Overview</h2>
        {topInsights.map((insight, index) => (
          <div key={`${insight.insight_type}-${index}`}>
            <InsightCard
              insightType={insight.result.type}
              viz={insight.result.viz}
              markup={insight.result.markup}
              chartHeightMultiplier={2}
            />
          </div>
        ))}
      </div>,
    );
  }

  if (followupInsights.length) {
    const topFollowupInsight = followupInsights[0];
    const remainingFollowupInsights = followupInsights.slice(1);
    const remainingIndices = remainingFollowupInsights.map((_, i) => i + 1);

    const visibleChipIndices = remainingIndices
      .filter((index) => !dismissedChipIndices.has(index))
      .slice(0, 3);

    const handleChipClick = (index: number): void => {
      setDismissedChipIndices((prev) => new Set([...prev, index]));
      setVisibleFollowupInsightOrder((prev) => [index, ...prev]);
    };

    const allQuestionsExplored =
      remainingFollowupInsights.length > 0 &&
      dismissedChipIndices.size === remainingFollowupInsights.length;

    if (remainingFollowupInsights.length > 0) {
      nodes.push(
        <>
          <h2 className={styles.title}>Discover Top Insights</h2>
          {allQuestionsExplored ? (
            <div className={styles.allExploredMessage}>
              You've explored all available questions for this metric.
            </div>
          ) : (
            <div className={styles.questionChipsContainer}>
              {visibleChipIndices.map((index) => {
                const insight = followupInsights[index];
                return (
                  <QuestionChip
                    key={`${insight.insight_type}-${index}`}
                    text={insight.result.question}
                    onClick={() => handleChipClick(index)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        handleChipClick(index);
                      }
                    }}
                  />
                );
              })}
            </div>
          )}
        </>,
      );
    }
    nodes.push(
      <div key="followup-insights">
        {visibleFollowupInsightOrder.map((insightIndex, position) => {
          const insight = followupInsights[insightIndex];
          return (
            <div
              key={`${insight.insight_type}-${insightIndex}`}
              ref={
                position === 0
                  ? (el) => {
                      topFollowupCardRef.current = el;
                    }
                  : undefined
              }
            >
              <InsightCard
                insightType={insight.result.type}
                viz={insight.result.viz}
                question={insight.result.question}
                markup={insight.result.markup}
              />
            </div>
          );
        })}
        <div key="top-followup-insight">
          <InsightCard
            insightType={topFollowupInsight.result.type}
            viz={topFollowupInsight.result.viz}
            question={topFollowupInsight.result.question}
            questionPrefix="Top insight about this change"
            markup={topFollowupInsight.result.markup}
          />
        </div>
      </div>,
    );
  }

  if (nodes.length === 0) {
    return <div className={styles.insightBundleRenderer}>No insights to display.</div>;
  }

  return <div className={styles.insightBundleRenderer}>{nodes}</div>;
}
