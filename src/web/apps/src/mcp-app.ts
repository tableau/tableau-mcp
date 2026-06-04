/**
 * @file Simple Tableau MCP App UI
 */
import './mcp-app.css';

import { App } from '@modelcontextprotocol/ext-apps';

// Create app instance
const app = new App({ name: 'Tableau MCP App', version: '1.0.0' });

// 2. Register handlers BEFORE connecting
app.onteardown = async () => {
  console.info("App is being torn down");
  return {};
};

app.ontoolinput = (params) => {
  console.info("Received tool call input:", params);
};

app.ontoolresult = (result) => {
  console.info("Received tool call result:", result);
};

app.ontoolcancelled = (params) => {
  console.info("Tool call cancelled:", params.reason);
};

// Register error handler
app.onerror = console.error;

// Connect to host
app.connect().then(() => {
  // eslint-disable-next-line no-console
  console.info('Tableau MCP App connected!');
});
