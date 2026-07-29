import '../shared/mcp-app.css';

import { App } from '@modelcontextprotocol/ext-apps';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import pkg from '~/package.json';

import { handleToolResult } from './handleToolResult.js';

const app = new App({ name: 'Tableau MCP App', version: pkg.version });
app.ontoolresult = (result: CallToolResult) => {
  void handleToolResult(app, result).catch((err) => {
    console.error('[mcp-app] Unhandled error in handleToolResult:', err);
  });
};
app.connect();
