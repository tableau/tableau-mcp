import type { App, McpUiHostContext } from '@modelcontextprotocol/ext-apps';
import { useApp } from '@modelcontextprotocol/ext-apps/react';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { StrictMode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';

import styles from './embed-tableau-viz.module.css';
import { getEmbeddingApiUrl } from './getEmbeddingApiUrl';
import { createIframeForEmbeddedContainer } from './iframeWithSrcDocBuilder';

// function extractTextContent(callToolResult: CallToolResult): string {
//   const textContent = callToolResult.content?.find((c) => c.type === 'text');
//   return textContent?.text ?? '';
// }

function EmbedTableauVizApp(): React.ReactNode {
  const [toolResult, setToolResult] = useState<CallToolResult | null>(null);
  const [hostContext, setHostContext] = useState<McpUiHostContext | undefined>();

  // `useApp` (1) creates an `App` instance, (2) calls `onAppCreated` to
  // register handlers, and (3) calls `connect()` on the `App` instance.
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
  toolResult: _toolResult,
  hostContext: _hostContext,
}: EmbedTableauVizProps): React.ReactNode {
  const containerRef = useRef<HTMLDivElement>(null);

  const workbookUrl = 'https://public.tableau.com/views/DataArtLetters/CreativeDataViz';

  const tagName = 'tableau-viz';
  const token = '';
  const iframe = createIframeForEmbeddedContainer(
    getEmbeddingApiUrl(workbookUrl),
    `<div id="component-container"><${tagName} src="${workbookUrl}" token="${token}" debug width="100%" height="600"></${tagName}></div>`,
  );

  return (
    <div
      ref={containerRef}
      className={styles.embedTableauViz}
      dangerouslySetInnerHTML={{ __html: iframe.outerHTML }}
    ></div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <EmbedTableauVizApp />
  </StrictMode>,
);
