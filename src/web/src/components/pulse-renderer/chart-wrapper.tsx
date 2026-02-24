import {
  calculateChartHeight,
  type InsightViz,
  renderVisualization,
} from '@tableau/ntbue-visualization-renderer';
import { useEffect, useRef, useState } from 'react';

import styles from './chart-wrapper.module.css';

type ChartWrapperProps = {
  insightType: string;
  spec: InsightViz;
};

const DEFAULT_HEIGHT_LINE_CHART = 224;
const DEFAULT_HEIGHT_BAR_CHART = 130;

export function ChartWrapper({ insightType, spec }: ChartWrapperProps): React.ReactNode {
  const containerRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number>(0);

  useEffect(() => {
    if (containerRef.current) {
      const width = containerRef.current.getBoundingClientRect().width ?? 0;
      const h = calculateChartHeight(
        insightType,
        spec,
        width,
        insightType === 'currenttrend' ? DEFAULT_HEIGHT_LINE_CHART : DEFAULT_HEIGHT_BAR_CHART,
      );
      setHeight(h);
    }
  }, [insightType, spec, containerRef]);

  useEffect(() => {
    if (containerRef.current) {
      const width = containerRef.current.getBoundingClientRect().width ?? 0;
      renderVisualization(insightType, spec, width, height, containerRef.current, {
        showTooltip: true,
      });
    }
  }, [insightType, spec, height]);

  return (
    <div ref={containerRef} className={styles.chartWrapper} style={{ height: `${height}px` }}></div>
  );
}
