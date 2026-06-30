import './mcp-app.css';

import { App } from '@modelcontextprotocol/ext-apps';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import pkg from '~/package.json';

import {
  isDeleteDatasourceConfirmResult,
  renderDeleteDatasourceConfirm,
} from './lib/deleteDatasourceConfirmClient.js';
import {
  isDeleteExtractRefreshTaskConfirmResult,
  renderDeleteExtractRefreshTaskConfirm,
} from './lib/deleteExtractRefreshTaskConfirmClient.js';
import {
  isDeleteWorkbookConfirmResult,
  renderDeleteWorkbookConfirm,
} from './lib/deleteWorkbookConfirmClient.js';
import { embedTableauViz } from './lib/embedTableauViz.js';
import { callGetEmbedTokenTool } from './lib/getEmbedTokenToolClient.js';
import { setupOpenInTableauLink } from './lib/openInTableauLink.js';
import {
  isUpdateCloudExtractRefreshTaskConfirmResult,
  renderUpdateCloudExtractRefreshTaskConfirm,
} from './lib/updateCloudExtractRefreshTaskConfirmClient.js';

const urlSchema = z.object({
  url: z.string().url(),
});

const callToolResultSchema = z.object({
  content: z
    .array(
      z.object({
        type: z.literal('text'),
        text: z.string(),
      }),
    )
    .nonempty(),
  isError: z.boolean().optional(),
});

/**
 * Loads the Tableau Embedding API script from the Tableau server
 */
function loadTableauEmbeddingApi(viewUrl: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // Check if custom elements are available (may be blocked in sandboxed iframes)
    if (!('customElements' in window)) {
      reject(new Error('Custom elements are not available. Cannot access tableau-viz element'));
      return;
    }

    // Check if already loaded
    if (customElements.get('tableau-viz')) {
      resolve();
      return;
    }

    // Derive embedding API URL from the view URL
    const serverOrigin = new URL(viewUrl).origin;
    const embeddingApiUrl = `${serverOrigin}/javascripts/api/tableau.embedding.3.latest.min.js`;

    const script = document.createElement('script');
    script.type = 'module';
    script.src = embeddingApiUrl;

    // Wait for custom element to be actually defined (not just script loaded)
    // This catches runtime errors that onload would miss
    script.onload = () => {
      // Race between custom element definition and 15 second timeout
      const definedPromise = customElements.whenDefined('tableau-viz');
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new Error('Tableau Embedding API failed to load within 15 seconds'));
        }, 15000);
      });

      Promise.race([definedPromise, timeoutPromise])
        .then(() => resolve())
        .catch((error) => reject(error));
    };

    script.onerror = () => {
      console.error('Failed to load Tableau Embedding API from:', embeddingApiUrl);
      reject(new Error(`Failed to load Tableau Embedding API from ${embeddingApiUrl}`));
    };
    document.head.appendChild(script);
  });
}

// Create app instance
const app = new App({ name: 'Tableau MCP App', version: pkg.version });

/**
 * Extracts the view URL from tool result content
 */
function extractUrlObjectFromResult(result: CallToolResult): string {
  const validated = callToolResultSchema.parse(result);
  const content = validated.content[0];

  const data = JSON.parse(content.text);
  const { url } = urlSchema.parse(data);
  return url;
}

// Handle tool results
app.ontoolresult = async (result: CallToolResult) => {
  try {
    // delete-workbook (flag ON) preview returns a confirm-panel payload, not a viz URL. Branch on
    // the result shape: render the HITL confirm panel; otherwise fall through to viz embedding.
    if (isDeleteWorkbookConfirmResult(result)) {
      renderDeleteWorkbookConfirm(app, result);
      return;
    }
    if (isDeleteDatasourceConfirmResult(result)) {
      renderDeleteDatasourceConfirm(app, result);
      return;
    }
    if (isDeleteExtractRefreshTaskConfirmResult(result)) {
      renderDeleteExtractRefreshTaskConfirm(app, result);
      return;
    }
    if (isUpdateCloudExtractRefreshTaskConfirmResult(result)) {
      renderUpdateCloudExtractRefreshTaskConfirm(app, result);
      return;
    }
    const viewUrl = extractUrlObjectFromResult(result);
    await loadTableauEmbeddingApi(viewUrl);
    const token = await callGetEmbedTokenTool(app);
    embedTableauViz(viewUrl, token);

    // Get the main container to append the "Open in Tableau" link
    const mainContainer = document.querySelector('.main') as HTMLElement;
    if (mainContainer) {
      setupOpenInTableauLink(app, viewUrl, mainContainer);
    }
  } catch (error) {
    console.error('Error handling tool result:', error);
  }
};

// Connect to host
app.connect();
