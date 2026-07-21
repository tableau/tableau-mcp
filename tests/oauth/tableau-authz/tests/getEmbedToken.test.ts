import { z } from 'zod';

import { getFeatureGate } from '../../../../src/features/init.js';
import { expect, test } from './base.js';

const tokenResponseSchema = z.object({
  token: z.string(),
  tokenType: z.string(),
});

test.describe('get-embed-token', () => {
  test('should return Bearer token', async ({ client }) => {
    test.skip(
      !(await getFeatureGate().isFeatureEnabled('mcp-apps')),
      'mcp-apps feature is disabled',
    );
    const result = await client.callTool('get-embed-token', {
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
