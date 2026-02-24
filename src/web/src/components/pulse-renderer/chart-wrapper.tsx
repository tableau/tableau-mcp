import { calculateChartHeight, renderVisualization } from '@tableau/ntbue-visualization-renderer';
import { useEffect, useRef, useState } from 'react';

import styles from './chart-wrapper.module.css';

type ChartWrapperProps = {
  insight: any;
};

const DEFAULT_HEIGHT_LINE_CHART = 224;
const DEFAULT_HEIGHT_BAR_CHART = 130;

export function ChartWrapper({ insight }: ChartWrapperProps): React.ReactNode {
  const containerRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number>(0);

  useEffect(() => {
    if (containerRef.current) {
      const viz = insight.result.viz;
      const width = containerRef.current.getBoundingClientRect().width ?? 0;
      const h = calculateChartHeight(
        insight.type,
        viz,
        width,
        insight.insight_type === 'currenttrend'
          ? DEFAULT_HEIGHT_LINE_CHART
          : DEFAULT_HEIGHT_BAR_CHART,
      );
      setHeight(h);
    }
  }, [insight, containerRef]);

  useEffect(() => {
    if (insight && containerRef.current) {
      const viz = insight.result.viz;
      const width = containerRef.current.getBoundingClientRect().width ?? 0;
      renderVisualization(insight.type, viz, width, height, containerRef.current, {
        showTooltip: true,
      });
    }
  }, [insight, height]);

  return (
    <div ref={containerRef} className={styles.chartWrapper} style={{ height: `${height}px` }}></div>
  );
}
