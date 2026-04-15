import type { App, McpUiHostContext } from '@modelcontextprotocol/ext-apps';
import { useApp } from '@modelcontextprotocol/ext-apps/react';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { StrictMode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import z from 'zod';

import styles from './embed-tableau-viz.module.css';
import { getEmbeddingApiUrl } from './getEmbeddingApiUrl.js';
import { createIframeForEmbeddedContainer } from './iframeWithSrcDocBuilder.js';

const embedVizResultSchema = z.object({ url: z.string(), token: z.string() });
type EmbedVizResult = z.infer<typeof embedVizResultSchema>;

function parseToolResult(callToolResult: CallToolResult): EmbedVizResult | null {
  const textContent = callToolResult.content?.find((c) => c.type === 'text');
  try {
    const parsed = JSON.parse(textContent?.text ?? '');
    // Handle ChatGPT's nested { text: string } wrapper
    const unwrapped =
      typeof parsed === 'object' && 'text' in parsed ? JSON.parse(parsed.text as string) : parsed;
    const result = embedVizResultSchema.safeParse(unwrapped);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

const STORAGE_KEY = 'embed-tableau-viz:tool-result';

function EmbedTableauVizApp(): React.ReactNode {
  const [toolResult, setToolResult] = useState<CallToolResult | null>(() => {
    try {
      const stored = sessionStorage.getItem(STORAGE_KEY);
      return stored ? (JSON.parse(stored) as CallToolResult) : null;
    } catch {
      return null;
    }
  });
  const [hostContext, setHostContext] = useState<McpUiHostContext | undefined>();

  const { app, isConnected, error } = useApp({
    appInfo: { name: 'Embed Tableau Viz App', version: '1.0.0' },
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
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(result));
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

  return <EmbedTableauViz app={app} toolResult={toolResult} hostContext={hostContext} />;
}

type EmbedTableauVizProps = {
  app: App;
  toolResult: CallToolResult | null;
  hostContext?: McpUiHostContext;
};

function EmbedTableauViz({
  app: _app,
  toolResult,
  hostContext: _hostContext,
}: EmbedTableauVizProps): React.ReactNode {
  const containerRef = useRef<HTMLDivElement>(null);
  const parsed = toolResult ? parseToolResult(toolResult) : null;

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !parsed) return;

    const { url: workbookUrl, token } = parsed;
    const iframe = createIframeForEmbeddedContainer(
      getEmbeddingApiUrl(workbookUrl),
      `<div id="component-container"><tableau-viz src="${workbookUrl}" token="${token}" width="100%" height="600"></tableau-viz></div>`,
    );
    container.appendChild(iframe);

    return () => {
      container.innerHTML = '';
    };
  }, [parsed?.url, parsed?.token]);

  if (!toolResult) {
    return (
      <div className={styles.embedTableauViz}>
        <div>Loading viz...</div>
      </div>
    );
  }

  if (!parsed) {
    return (
      <div className={styles.embedTableauViz}>
        <div>Failed to parse viz result.</div>
      </div>
    );
  }

  return <div ref={containerRef} className={styles.embedTableauViz} />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <EmbedTableauVizApp />
  </StrictMode>,
);
