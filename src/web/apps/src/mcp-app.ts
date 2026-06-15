/**
 * @file Simple Tableau MCP App UI
 */
import './mcp-app.css';

import { App } from '@modelcontextprotocol/ext-apps';

import pkg from '~/package.json';

import { embedTableauViz, extractViewUrlFromResult } from './lib/embedTableauViz.js';
import { callGetOAuthTokenTool } from './lib/getOAuthTokenToolClient.js';

// Create app instance
const app = new App({ name: 'Tableau MCP App', version: pkg.version });

// Handle tool results
app.ontoolresult = async (result) => {
  console.info('Tool result received:', result);

  try {
    // Extract the view URL from the result
    const viewUrl = extractViewUrlFromResult(result);

    if (!viewUrl) {
      console.warn('No view URL found in tool result');
      return;
    }

    console.info('View URL extracted:', viewUrl);

    // Retrieve the Bearer token
    const token = await callGetOAuthTokenTool(app);
    console.info('OAuth token retrieved');

    // Embed the Tableau visualization
    embedTableauViz('tableauVizContainer', viewUrl, token);
  } catch (error) {
    console.error('Failed to embed Tableau viz:', error);
  }
};

// Connect to host
app.connect().then(() => {
  console.info('Tableau MCP App connected!');
});
