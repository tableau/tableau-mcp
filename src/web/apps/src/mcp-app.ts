import './mcp-app.css';

import { App } from '@modelcontextprotocol/ext-apps';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import pkg from '~/package.json';

import { handleToolResult } from './lib/handleToolResult.js';

const app = new App({ name: 'Tableau MCP App', version: pkg.version });

// The host delivers a tool's complete arguments via `ui/notifications/tool-input` BEFORE the result
// (`ui/notifications/tool-result`). We stash the built dashboard HTML from the *input* here so the
// result handler can render a preview of exactly what was published — without the HTML ever being
// echoed back into the tool result (which would cost model context tokens). Only create-and-publish
// -workbook carries an `html` arg, so this is naturally scoped to the publish flow.
let capturedDashboardHtml: string | undefined;

// Both handlers MUST be registered before connect() so no early notification is missed.
app.ontoolinput = (params) => {
  const html = params.arguments?.html;
  capturedDashboardHtml = typeof html === 'string' ? html : undefined;
};

app.ontoolresult = (result: CallToolResult) => {
  void handleToolResult(app, result, capturedDashboardHtml).catch((err) => {
    console.error('[mcp-app] Unhandled error in handleToolResult:', err);
  });
};

app.connect();
