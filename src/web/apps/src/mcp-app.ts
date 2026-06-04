/**
 * @file Simple Tableau MCP App UI
 */
import './mcp-app.css';

import { App } from '@modelcontextprotocol/ext-apps';

// Create app instance
const app = new App({ name: 'Tableau MCP App', version: '1.0.0' });

// Connect to host
app.connect().then(() => {
  // eslint-disable-next-line no-console
  console.info('Tableau MCP App connected!');
});
