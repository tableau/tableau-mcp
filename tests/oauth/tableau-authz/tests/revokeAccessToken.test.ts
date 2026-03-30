import { z } from 'zod';

import { expect, test } from './base.js';

const revokeResultSchema = z.object({
  message: z.string(),
});

/**
 * This test intentionally destroys the MCP session by revoking the Tableau access token.
 * It MUST be the only test in its worker. Subsequent tool calls after revocation will fail.
 *
 * The fixture teardown calls revokeToken() again, which will warn (not throw) because the
 * token is already invalid — this is intentional and expected.
 */
test.describe('revoke-access-token', () => {
  test('revokes the Tableau access token and invalidates the session', async ({ client }) => {
    const result = await client.callTool('revoke-access-token', {
      schema: revokeResultSchema,
      toolArgs: {},
    });

    expect(result.message).toContain('revocation');

    // After revocation the token is invalid. Subsequent Tableau REST API calls
    // should fail with an authentication error from Tableau's servers.
    await expect(
      client.callTool('list-workbooks', {
        schema: z.array(z.record(z.string(), z.unknown())),
        toolArgs: {},
      }),
    ).rejects.toThrow();
  });
});
