/**
 * @file Authentication utilities for Tableau MCP App
 */
import { App } from '@modelcontextprotocol/ext-apps';
import { z } from 'zod';

const oauthTokenResultSchema = z.object({
  content: z.array(
    z.object({
      type: z.literal('text'),
      text: z.string(),
    }),
  ),
});

const oauthTokenDataSchema = z.object({
  token: z.string(),
});

/**
 * Calls the get-oauth-token tool to retrieve the OAuth Bearer token from the MCP server
 * @param app - The MCP App instance
 * @returns Promise containing the OAuth token string
 */
export async function callGetOAuthTokenTool(app: App): Promise<string> {
  // Ensure the host allows calling server tools before attempting to retrieve the token.
  // If unsupported, throw so the caller's top-level handler can surface an error to the user.
  const capabilities = app.getHostCapabilities();
  if (!capabilities?.serverTools) {
    throw new Error(
      'Cannot retrieve OAuth token: the MCP host does not support server tools (serverTools capability is unavailable).',
    );
  }

  const result = await app.callServerTool({
    name: 'get-oauth-token',
    arguments: {},
  });

  // Validate and parse the result to extract the token
  const validated = oauthTokenResultSchema.parse(result);
  const content = validated.content[0];
  const data = JSON.parse(content.text);
  const tokenData = oauthTokenDataSchema.parse(data);

  return tokenData.token;
}
