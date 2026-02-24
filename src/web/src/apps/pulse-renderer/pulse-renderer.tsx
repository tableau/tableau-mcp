import type { App, McpUiHostContext } from '@modelcontextprotocol/ext-apps';
import { useApp } from '@modelcontextprotocol/ext-apps/react';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { StrictMode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import z from 'zod';

import { pulseBundleResponseSchema } from '../../../../sdks/tableau/types/pulse';
import { ChartWrapper } from '../../components/pulse-renderer/chart-wrapper';
import { InsightGroupType } from '../../components/pulse-renderer/enums';
import { useToolResult } from '../../hooks/useToolResult';
import styles from './pulse-renderer.module.css';

function PulseRendererApp(): React.ReactNode {
  const [toolResult, setToolResult] = useState<CallToolResult | null>(null);
  const [hostContext, setHostContext] = useState<McpUiHostContext | undefined>();

  // `useApp` (1) creates an `App` instance, (2) calls `onAppCreated` to
  // register handlers, and (3) calls `connect()` on the `App` instance.
  const { app, isConnected, error } = useApp({
    appInfo: { name: 'Pulse Renderer App', version: '1.0.0' },
    capabilities: {},
    onAppCreated: (app) => {
      app.onteardown = async () => {
        console.info('App is being torn down');
        return {};
      };

      app.ontoolinput = async (input) => {
        console.info('Received tool call input:', input);
      };

      app.ontoolresult = async (result) => {
        console.info('Received tool call result:', result);
        setToolResult(result);
      };

      app.ontoolcancelled = (params) => {
        console.info('Tool call cancelled:', params.reason);
      };

      app.onerror = console.error;

      app.onhostcontextchanged = (params) => {
        setHostContext((prev) => ({ ...prev, ...params }));
      };
    },
  });

  useEffect(() => {
    if (app) {
      setHostContext(app.getHostContext());
    }
  }, [app]);

  if (error) {
    return (
      <div>
        <strong>ERROR:</strong> {error.message}
      </div>
    );
  }

  if (!app || !isConnected) {
    return <div>Connecting...</div>;
  }

  return <PulseRenderer app={app} toolResult={toolResult} hostContext={hostContext} />;
}

type PulseRendererProps = {
  app: App;
  toolResult: CallToolResult | null;
  hostContext?: McpUiHostContext;
};

function PulseRenderer({
  app: _app,
  toolResult,
  hostContext: _hostContext,
}: PulseRendererProps): React.ReactNode {
  const containerRef = useRef<HTMLDivElement>(null);

  const result = useToolResult(toolResult, z.object({ bundle: pulseBundleResponseSchema }));
  const bundle = result.success ? result.data.bundle.bundle_response.result : undefined;
  const allInsights =
    bundle?.insight_groups.find((group) => group.type === InsightGroupType.Followup)?.insights ??
    [];

  const insightsWithCards = allInsights.filter(
    (insight) => insight.insight_type !== 'unusualchange',
  );
  const [topInsight, ...otherInsights] = insightsWithCards;

  if (!result.success) {
    return (
      <div ref={containerRef} className={styles.pulseRenderer}>
        <div>Failed to parse Pulse bundle response.</div>
      </div>
    );
  }

  if (!topInsight) {
    return (
      <div ref={containerRef} className={styles.pulseRenderer}>
        <div>No insights to display.</div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className={styles.pulseRenderer}>
      <div className={styles.insightContent}>
        <div className={styles.topInsight}>
          <div className={styles.topInsightTitle}>{topInsight.result.question}</div>
          <div
            className={styles.topInsightContent}
            dangerouslySetInnerHTML={{ __html: topInsight.result.markup ?? '' }}
          />
          <ChartWrapper insightType={topInsight.insight_type} spec={topInsight.result.viz} />
        </div>
        <div className={styles.otherInsights}>
          {otherInsights.map((insight, index) => (
            <div key={`${insight.insight_type}-${index}`} className={styles.otherInsight}>
              <div className={styles.otherInsightTitle}>{insight.result.question}</div>
              <div
                className={styles.otherInsightContent}
                dangerouslySetInnerHTML={{ __html: insight.result.markup ?? '' }}
              />
              <ChartWrapper insightType={insight.insight_type} spec={insight.result.viz} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PulseRendererApp />
  </StrictMode>,
);
