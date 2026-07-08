import './mcp-app.css';

import { App } from '@modelcontextprotocol/ext-apps';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import pkg from '~/package.json';

import { handleConfirmResult } from './lib/handleConfirmResult.js';

const app = new App({ name: 'Tableau MCP App', version: pkg.version });
app.ontoolresult = (result: CallToolResult) => {
  try {
    handleConfirmResult(app, result);
  } catch (err) {
    console.error('[hitl-confirm] Unhandled error in handleConfirmResult:', err);
  }
};
app.connect();
