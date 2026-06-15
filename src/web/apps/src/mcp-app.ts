/**
 * @file Simple Tableau MCP App UI
 */
import './mcp-app.css';

import { App } from '@modelcontextprotocol/ext-apps';

import pkg from '~/package.json';

import { callGetOAuthTokenTool } from './lib/getOAuthTokenToolClient.js';

// Create app instance
const app = new App({ name: 'Tableau MCP App', version: pkg.version });

// Handle tool results
app.ontoolresult = async (result) => {
  console.info('Tool result received:', result);

  // Retrieve the Bearer token
  const token = await callGetOAuthTokenTool(app);
  console.info('Token:', token);
};

// Connect to host
app.connect().then(() => {
  console.info('Tableau MCP App connected!');
});
