/**
 * @file Simple Tableau MCP App UI
 */
import './mcp-app.css';

import { App } from '@modelcontextprotocol/ext-apps';

import pkg from '~/package.json';

// Create app instance
const app = new App({ name: 'Tableau MCP App', version: pkg.version });

// Connect to host
app.connect().then(() => {
  console.info('Tableau MCP App connected!');
});
