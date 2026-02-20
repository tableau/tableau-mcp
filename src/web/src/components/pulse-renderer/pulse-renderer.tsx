import type { App, McpUiHostContext } from '@modelcontextprotocol/ext-apps';
import { useApp } from '@modelcontextprotocol/ext-apps/react';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { calculateChartHeight, renderVisualization } from '@tableau/ntbue-visualization-renderer';
import { StrictMode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';

import styles from './pulse-renderer.module.css';

const DEFAULT_HEIGHT = 500;

function extractTextContent(callToolResult: CallToolResult): string {
  const textContent = callToolResult.content?.find((c) => c.type === 'text');
  return textContent?.text ?? '';
}

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
  app,
  toolResult,
  hostContext: _hostContext,
}: PulseRendererProps): React.ReactNode {
  const [bundle, setBundle] = useState<any>(null);
  const content = toolResult ? extractTextContent(toolResult) : '{}';
  const { bundleRequest, bundleType, insightGroupType, insightType } = JSON.parse(content);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    console.info('Calling pulse-renderer tool...');
    callPulseRendererTool();
  }, []);

  async function callPulseRendererTool(): Promise<void> {
    console.info('Calling pulse-renderer tool...');
    const result = await app.callServerTool({
      name: 'pulse-renderer',
      arguments: { bundleRequest, bundleType },
    });

    if (result.isError) {
      console.error('Error calling pulse-renderer tool:', result.error);
      return;
    }

    const content = toolResult ? extractTextContent(result) : '{}';
    const bundle = JSON.parse(content);
    setBundle(bundle);
  }

  useEffect(() => {
    if (bundle?.insight_groups && containerRef.current) {
      const insightGroup =
        bundle.insight_groups.find((group: any) => group.type === insightGroupType) ??
        bundle.insight_groups[0];

      const insight =
        insightGroup.insights.find((insight: any) => insight.type === insightType) ??
        insightGroup.insights[0];

      if (!insight) {
        return;
      }

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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PulseRendererApp />
  </StrictMode>,
);
