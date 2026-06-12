/**
 * @file Simple Tableau MCP App UI
 */
import './mcp-app.css';

import { App } from '@modelcontextprotocol/ext-apps';

import pkg from '~/package.json';

// Global error handlers
window.addEventListener('error', (event) => {
  console.error('Uncaught error:', event.error);
  showError(`An unexpected error occurred: ${event.error?.message || 'Unknown error'}`);
});

window.addEventListener('unhandledrejection', (event) => {
  console.error('Unhandled promise rejection:', event.reason);
  showError(`An unexpected error occurred: ${event.reason?.message || 'Promise rejection'}`);
});

// Create app instance
const app = new App({ name: 'Tableau MCP App', version: pkg.version });

// Handle tool results
app.ontoolresult = async (params) => {
  try {
    if (params.isError) {
      console.error('Tool execution failed:', params.content);
      showError('Tool execution failed. Please try again.');
      return;
    }

    // Extract URL from the tool result content
    const content = params.content.find((c) => c.type === 'text');
    if (content && content.type === 'text') {
      const result = JSON.parse(content.text);
      if (result.url) {
        // Get OAuth token before rendering
        const token = await getOAuthToken();
        if (!token) {
          showError('Failed to get OAuth token. Cannot render visualization.');
          return;
        }
        renderVisualization(result.url, token);
      }
    }
  } catch (e) {
    console.error('Error handling tool result:', e);
    showError(`Failed to render visualization: ${e instanceof Error ? e.message : 'Unknown error'}`);
  }
};

// Connect to host
app.connect().then(() => {
  console.info('Tableau MCP App connected!');
}).catch((error) => {
  console.error('Failed to connect:', error);
  showError(`Failed to connect to MCP host: ${error.message || 'Unknown error'}`);
});

async function getOAuthToken(): Promise<string | null> {
  try {
    const result = await app.callServerTool({
      name: 'get-oauth-token',
      arguments: {},
    });

    if (result.isError) {
      console.error('Failed to get OAuth token:', result.content);
      return null;
    }

    const content = result.content.find((c) => c.type === 'text');
    if (content && content.type === 'text') {
      const tokenResult = JSON.parse(content.text);
      return tokenResult.token;
    }
  } catch (e) {
    console.error('Error calling get-oauth-token:', e);
    showError(`Failed to retrieve OAuth token: ${e instanceof Error ? e.message : 'Unknown error'}`);
  }

  return null;
}

function showError(message: string): void {
  const main = document.querySelector('.main');
  if (!main) return;

  main.innerHTML = `
    <div class="hero">
      <div class="emoji">⚠️</div>
      <h1>Error</h1>
      <p>${message}</p>
    </div>
  `;
}

function renderVisualization(_url: string, token: string): void {
  const main = document.querySelector('.main') as HTMLElement;
  if (!main) return;
  console.log(token);

  // Make main container fill available space
  main.style.minHeight = '100vh';
  main.style.margin = '0';
  main.style.padding = '0';
  main.style.maxWidth = 'none';

  // Create tableau-viz element with explicit height
  const vizElement = document.createElement('tableau-viz');
  vizElement.setAttribute('src', _url);
  vizElement.setAttribute('token', token);
  vizElement.style.width = '100%';
  vizElement.style.height = '800px';

  // Replace loading content with viz
  main.innerHTML = '';
  main.appendChild(vizElement);
}
