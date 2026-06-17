import './mcp-app.css';

import { App } from '@modelcontextprotocol/ext-apps';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import pkg from '~/package.json';

import { embedTableauViz } from './lib/embedTableauViz.js';
import { callGetOAuthTokenTool } from './lib/getOAuthTokenToolClient.js';

const urlSchema = z.object({
  url: z.string().url(),
});

const callToolResultSchema = z.object({
  content: z.array(
    z.object({
      type: z.literal('text'),
      text: z.string(),
    }),
  ),
  isError: z.boolean().optional(),
});

/**
 * Loads the Tableau Embedding API script from the Tableau server
 */
function loadTableauEmbeddingApi(viewUrl: string): Promise<void> {
  return new Promise((resolve, reject) => {
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
    script.onload = () => resolve();
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
  const url = urlSchema.parse(data);
  return url.url;
}

// Handle tool results
app.ontoolresult = async (result: CallToolResult) => {
  try {
    const viewUrl = extractUrlObjectFromResult(result);
    await loadTableauEmbeddingApi(viewUrl);
    const token = await callGetOAuthTokenTool(app);
    embedTableauViz(viewUrl, token);
  } catch (error) {
    console.error('Error embedding viz:', error);
  }
};

// Connect to host
app.connect();
