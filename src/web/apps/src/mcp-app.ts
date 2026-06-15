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
  try {
    // Extract the view URL from the result
    const viewUrl = extractViewUrlFromResult(result);

    if (!viewUrl) {
      return;
    }

    // Retrieve the Bearer token
    const token = await callGetOAuthTokenTool(app);

    // Embed the Tableau visualization
    embedTableauViz('tableauVizContainer', viewUrl, token);
  } catch {
    // Silently handle errors
  }
};

// Connect to host
app.connect();
