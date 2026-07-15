import './mcp-app.css';

import { App } from '@modelcontextprotocol/ext-apps';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import pkg from '~/package.json';

import { handleToolResult } from './lib/handleToolResult.js';

// The host picks the initial (and only) display mode; we advertise just `inline`. There is no
// in-feed dashboard preview, so we no longer request `fullscreen`.
const app = new App(
  { name: 'Tableau MCP App', version: pkg.version },
  { availableDisplayModes: ['inline'] },
);

// The result handler MUST be registered before connect() so no early notification is missed.
app.ontoolresult = (result: CallToolResult) => {
  void handleToolResult(app, result).catch((err) => {
    console.error('[mcp-app] Unhandled error in handleToolResult:', err);
  });
};

app.connect();
