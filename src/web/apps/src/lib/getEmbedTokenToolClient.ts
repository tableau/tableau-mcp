/**
 * @file getEmbedTokenToolClient - Tableau MCP App embed token utilities
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
 * Calls the get-embed-token tool to retrieve the embed token from the MCP server
 * @param app - The MCP App instance
 * @returns Promise containing the embed token string
 */
export async function callGetEmbedTokenTool(app: App): Promise<string> {
  const result = await app.callServerTool({
    name: 'get-embed-token',
    arguments: {},
  });

  // Validate and parse the result to extract the token
  const validated = oauthTokenResultSchema.parse(result);
  const content = validated.content[0];
  const data = JSON.parse(content.text);
  const tokenData = oauthTokenDataSchema.parse(data);

  return tokenData.token;
}
