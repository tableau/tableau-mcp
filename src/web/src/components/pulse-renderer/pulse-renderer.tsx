import { Routes, Route, BrowserRouter } from 'react-router-dom';
import { calculateChartHeight, renderVisualization } from '@tableau/ntbue-visualization-renderer';
import { useEffect, useRef } from 'react';
import { PulseInsightBundle } from './types';
import { useWidgetProps } from '../../useWidgetProps';
import styles from './pulse-renderer.module.css';

const DEFAULT_HEIGHT = 224;

function PulseRenderer() {
  const { bundle } = useWidgetProps<{ bundle: PulseInsightBundle | null }>({ bundle: null });
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (bundle?.insight_groups && containerRef.current) {
      const insight = bundle.insight_groups[0].insights[0];

      if (!insight) {
        return;
      }

      const insightType = insight.insight_type;
      const viz = insight.result.viz;
      const width = containerRef.current.getBoundingClientRect().width ?? 0;
      const height = calculateChartHeight(insightType, viz, width, DEFAULT_HEIGHT);
      renderVisualization(insightType, viz, width, height, containerRef.current, {
        showTooltip: true,
      });
    }
  }, [bundle]);

  return <div ref={containerRef} className={styles.pulseRenderer}></div>;
}

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/:planet?" element={<PulseRenderer />} />
      </Routes>
    </BrowserRouter>
  );
}
