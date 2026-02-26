import type { App, McpUiHostContext } from '@modelcontextprotocol/ext-apps';
import { useApp } from '@modelcontextprotocol/ext-apps/react';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import z from 'zod';

import {
  pulseBundleResponseSchema,
  type PulseInsightBundleType,
  pulseInsightBundleTypeEnum,
} from '../../../../sdks/tableau/types/pulse';
import { InsightGroupType } from '../../components/pulse-renderer/enums';
import { InsightBundleRenderer } from '../../components/pulse-renderer/insight-bundle-renderer';
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
  // Call hooks unconditionally (before any early returns) to satisfy Rules of Hooks
  const result = useToolResult(
    toolResult,
    z.object({ bundle: pulseBundleResponseSchema, bundleType: z.enum(pulseInsightBundleTypeEnum) }),
  );

  if (!toolResult) {
    return (
      <div className={styles.pulseRenderer}>
        <div>Loading Pulse insights...</div>
      </div>
    );
  }

  if (!result.success) {
    return (
      <div className={styles.pulseRenderer}>
        <div>Failed to parse Pulse bundle response.</div>
        <div>{result.error.message}</div>
      </div>
    );
  }

  const bundle = result.data.bundle.bundle_response.result;
  const bundleType = result.data.bundleType;
  const topInsightGroupType = getInsightGroupType(bundleType);

  return (
    <InsightBundleRenderer
      bundle={bundle}
      insightGroupTypes={new Set([topInsightGroupType, InsightGroupType.Followup])}
    />
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PulseRendererApp />
  </StrictMode>,
);

function getInsightGroupType(bundleType: PulseInsightBundleType): InsightGroupType {
  switch (bundleType) {
    case 'ban':
      return InsightGroupType.BAN;
    case 'springboard':
      return InsightGroupType.Top;
    case 'basic':
      return InsightGroupType.Top;
    case 'detail':
      return InsightGroupType.Followup;
    case 'exploration':
      return InsightGroupType.Anchor;
    case 'breakdown':
      return InsightGroupType.Breakdown;
  }
}
