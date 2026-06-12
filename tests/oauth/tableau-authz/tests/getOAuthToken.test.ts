import { z } from 'zod';

import { expect, test } from './base.js';

const tokenResponseSchema = z.object({
  token: z.string(),
  tokenType: z.string(),
});

test.describe('get-oauth-token', () => {
  test('should return Bearer token', async ({ client }) => {
    const result = await client.callTool('get-oauth-token', {
      schema: tokenResponseSchema,
      toolArgs: {},
    });

    expect(result).toMatchObject({
      token: expect.any(String),
      tokenType: 'Bearer',
    });

    // Verify token is not empty
    expect(result.token.length).toBeGreaterThan(0);
  });
});
