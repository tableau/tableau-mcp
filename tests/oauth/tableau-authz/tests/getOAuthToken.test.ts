import { readFileSync } from 'fs';

import { z } from 'zod';

import { expect, test } from './base.js';

const tokenResponseSchema = z.object({
  token: z.string(),
  tokenType: z.string(),
});

// Check if mcp-apps feature is enabled
function isMcpAppsEnabled(): boolean {
  try {
    const features = JSON.parse(readFileSync('features.json', 'utf-8'));
    return features['mcp-apps'] === true;
  } catch {
    return false;
  }
}

test.describe('get-oauth-token', () => {
  test('should return Bearer token', async ({ client }) => {
    test.skip(!isMcpAppsEnabled(), 'mcp-apps feature is disabled');
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
