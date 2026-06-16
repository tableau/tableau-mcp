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

// Create app instance
const app = new App({ name: 'Tableau MCP App', version: pkg.version });

/**
 * Extracts the view URL from tool result content
 */
function extractUrlObjectFromResult(result: CallToolResult): string {
  const content = result.content?.[0];
  if (content?.type !== 'text') {
    throw new Error('Tool result does not contain text content');
  }

  const data = JSON.parse(content.text);
  const validated = urlSchema.parse(data);
  return validated.url;
}

// Handle tool results
app.ontoolresult = async (result: CallToolResult) => {
  try {
    const viewUrl = extractUrlObjectFromResult(result);
    const token = await callGetOAuthTokenTool(app);
    embedTableauViz(viewUrl, token);
  } catch (error) {
    console.log(error);
  }
};

// Connect to host
app.connect();
