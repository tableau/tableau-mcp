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
 * @returns The embed token string, or null when no token is available for the
 *   current configuration (the app should then skip embedding).
 */
export async function callGetEmbedTokenTool(app: App): Promise<string | null> {
  const result = await app.callServerTool({
    name: 'get-embed-token',
    arguments: {},
  });

  // No token available for this configuration (e.g. PAT without an embed credential):
  // the tool returns an error result. Treat that as a clean skip, not a failure.
  if ((result as { isError?: boolean }).isError) {
    return null;
  }

  // Validate and parse the result to extract the token
  const validated = embedTokenResultSchema.parse(result);
  const content = validated.content[0];
  const data = JSON.parse(content.text);
  const tokenData = embedTokenDataSchema.parse(data);

  return tokenData.token;
}
