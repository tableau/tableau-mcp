/**
 * @file Simple Tableau MCP App UI
 */
import './mcp-app.css';

import { App } from '@modelcontextprotocol/ext-apps';

import pkg from '~/package.json';

// Create app instance
const app = new App({ name: 'Tableau MCP App', version: pkg.version });

/**
 * Retrieves the OAuth Bearer token from the MCP server
 * @returns Promise containing the OAuth token string
 */
async function getOAuthToken(): Promise<string> {
  try {
    const result = await app.callServerTool({
      name: 'get-oauth-token',
      arguments: {},
    });

    // Parse the result to extract the token
    const content = result.content[0];
    if (content.type === 'text') {
      const data = JSON.parse(content.text);
      const token = data.token;
      console.info('OAuth token retrieved');
      return token;
    }

    throw new Error('Unexpected response format from get-oauth-token');
  } catch (error) {
    console.error('Failed to retrieve OAuth token:', error);
    throw error;
  }
}

// Handle tool results
app.ontoolresult = async (result) => {
  console.info('Tool result received:', result);

  // Retrieve the Bearer token
  const token = await getOAuthToken();
  console.info('Token:', token);
};

// Connect to host
app.connect().then(() => {
  console.info('Tableau MCP App connected!');
});
