import { z } from 'zod';

import { getDefaultEnv, resetEnv, setEnv } from '../testEnv.js';
import { McpClient } from './mcpClient.js';

const tokenResponseSchema = z.object({
  token: z.string(),
  tokenType: z.string(),
});

describe('get-oauth-token', () => {
  it('should return Bearer token in OAuth Bearer mode', async () => {
    // Skip this test if not in OAuth Bearer mode
    // In a real OAuth E2E test, you would:
    // 1. Set up OAuth environment variables with Bearer auth
    // 2. Create a client with OAuth Bearer auth
    // 3. Call the tool and verify Bearer token response
    // This is a placeholder to demonstrate the pattern

    const env = getDefaultEnv();
    if (env.AUTH !== 'oauth') {
      return; // Skip test in non-OAuth mode
    }

    const client = new McpClient();
    await client.connect();

    const result = await client.callTool('get-oauth-token', {
      schema: tokenResponseSchema,
      toolArgs: {},
    });

    expect(result).toMatchObject({
      token: expect.any(String),
      tokenType: 'Bearer', // Only Bearer tokens supported
    });

    // Verify token is not empty
    expect(result.token.length).toBeGreaterThan(0);

    await client.close();
  });
});
