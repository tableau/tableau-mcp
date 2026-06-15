/**
 * @file Authentication utilities for Tableau MCP App
 */
import { App } from '@modelcontextprotocol/ext-apps';

/**
 * Calls the get-oauth-token tool to retrieve the OAuth Bearer token from the MCP server
 * @param app - The MCP App instance
 * @returns Promise containing the OAuth token string
 */
export async function callGetOAuthTokenTool(app: App): Promise<string> {
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
