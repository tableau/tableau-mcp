/**
 * @file Simple Tableau MCP App UI
 */
import './mcp-app.css';

import { App } from '@modelcontextprotocol/ext-apps';

import pkg from '~/package.json';

// Create app instance
const app = new App({ name: 'Tableau MCP App', version: pkg.version });

// Handle tool results
app.ontoolresult = (params) => {
  if (params.isError) {
    console.error('Tool execution failed:', params.content);
    return;
  }

  // Extract URL from the tool result content
  const content = params.content.find((c) => c.type === 'text');
  if (content && content.type === 'text') {
    try {
      const result = JSON.parse(content.text);
      if (result.url) {
        renderVisualization(result.url);
      }
    } catch (e) {
      console.error('Failed to parse tool result:', e);
    }
  }
};

// Connect to host
app.connect().then(() => {
  console.info('Tableau MCP App connected!');
});

function renderVisualization(_url: string): void {
  const main = document.querySelector('.main');
  if (!main) return;

  // Create tableau-viz element with hardcoded public view
  const vizElement = document.createElement('tableau-viz');
  vizElement.setAttribute('src', 'https://public.tableau.com/views/DeveloperSuperstore/Overview');
  vizElement.style.width = '100%';
  vizElement.style.height = '800px';

  // Replace loading content with viz
  main.innerHTML = '';
  main.appendChild(vizElement);
}
