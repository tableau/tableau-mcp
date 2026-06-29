/**
 * @file getEmbedTokenToolClient - Tableau MCP App embed token utilities
 */
import { App } from '@modelcontextprotocol/ext-apps';
import { z } from 'zod';

const embedTokenResultSchema = z.object({
  content: z.array(
    z.object({
      type: z.literal('text'),
      text: z.string(),
    }),
  ),
});

const embedTokenDataSchema = z.object({
  token: z.string(),
});

/**
 * Calls the get-embed-token tool to retrieve the embed token from the MCP server.
 * @param app - The MCP App instance
 * @returns The embed token string.
 * @throws When no token is available for the current configuration (e.g. PAT
 *   without an embed credential), surfacing the server's error message.
 */
export async function callGetEmbedTokenTool(app: App): Promise<string> {
  // Ensure the host allows calling server tools before attempting to retrieve the token.
  // If unsupported, throw so the caller's top-level handler can surface an error to the user.
  const capabilities = app.getHostCapabilities();
  if (!capabilities?.serverTools) {
    throw new Error(
      'Cannot retrieve embed token: the MCP host does not support server tools (serverTools capability is unavailable).',
    );
  }

  const result = await app.callServerTool({
    name: 'get-embed-token',
    arguments: {},
  });

  // No token available for this configuration (e.g. PAT without an embed credential):
  // the tool returns an error result.
  if (result.isError) {
    throw new Error('Failed to get an embed token for the current authentication configuration.');
  }

  // Validate and parse the result to extract the token
  const validated = embedTokenResultSchema.parse(result);
  const content = validated.content[0];
  const data = JSON.parse(content.text);
  const tokenData = embedTokenDataSchema.parse(data);

  return tokenData.token;
}
