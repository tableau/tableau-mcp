import { z } from 'zod';

import { getDefaultEnv, resetEnv, setEnv } from '../../testEnv.js';
import { McpClient } from '../mcpClient.js';

/**
 * E2E coverage for the admin-only, mutating `update-user` tool.
 *
 * The tool is two-phase with a server-authoritative preview→confirm gate: the first call (confirm
 * omitted/false) reports the current and proposed site role, changes nothing, and returns a
 * server-generated single-use `confirmationToken` bound to the previewed `userId:siteRole`. The
 * second call passes `confirm: true` plus that token; the server verifies and consumes it before
 * applying the role change.
 *
 * The mutating leg is gated behind `UPDATE_USER_E2E_ID` — set it to a disposable user LUID once
 * the endpoint is enabled on your Cloud site.
 */
describe('update-user', () => {
  let client: McpClient;
  let toolsAvailable = false;

  beforeAll(setEnv);
  afterAll(resetEnv);

  beforeAll(async () => {
    client = new McpClient({
      env: { ...getDefaultEnv(), ADMIN_TOOLS_ENABLED: 'true' },
    });
    await client.connect();
    const tools = await client.listTools();
    toolsAvailable = tools.includes('update-user');
    if (!toolsAvailable) {
      console.warn(
        'Skipping update-user e2e tests — admin tools not registered. ' +
          'Ensure ADMIN_TOOLS_ENABLED=true in tests/.env and the caller is a site admin.',
      );
    }
  });

  afterAll(async () => {
    await client.close();
  });

  it('should register the tool only when admin tools are enabled', async () => {
    const defaultClient = new McpClient({ env: getDefaultEnv() });
    await defaultClient.connect();
    try {
      const tools = await defaultClient.listTools();
      expect(tools.includes('update-user')).toBe(false);
    } finally {
      await defaultClient.close();
    }
  });

  it('should reject an invalid (non-UUID) userId at schema level', async () => {
    if (!toolsAvailable) {
      return;
    }

    let threw = false;
    try {
      await client.callTool('update-user', {
        schema: z.string(),
        toolArgs: { userId: 'not-a-valid-uuid', siteRole: 'Unlicensed' },
      });
    } catch (e) {
      threw = true;
      expect(String(e)).toContain('uuid');
    }
    expect(threw).toBe(true);
  });

  it('should reject an invalid siteRole at schema level', async () => {
    if (!toolsAvailable) {
      return;
    }

    let threw = false;
    try {
      await client.callTool('update-user', {
        schema: z.string(),
        toolArgs: {
          userId: 'a1b2c3d4-e5f6-4789-9abc-ef1234567890',
          siteRole: 'InvalidRole',
        },
      });
    } catch (e) {
      threw = true;
      expect(String(e).toLowerCase()).toMatch(/siterole|enum|invalid/);
    }
    expect(threw).toBe(true);
  });

  it('should return a preview with a confirmationToken when confirm is omitted', async () => {
    if (!toolsAvailable) {
      return;
    }
    // resolveTarget calls queryUserOnSite — needs a real user on the site.
    const userId = process.env.UPDATE_USER_E2E_ID;
    if (!userId) {
      console.warn(
        'Skipping preview assertion — set UPDATE_USER_E2E_ID to a real user LUID on the site.',
      );
      return;
    }
    const message = await client.callTool('update-user', {
      schema: z.string(),
      toolArgs: { userId, siteRole: 'Unlicensed' },
    });
    expect(message).toContain('Preview');
    expect(message).toContain('No change has been made');
    expect(message).toContain('confirmationToken:');
  });

  it('should reject a confirmed call with a bogus (never-previewed) confirmationToken', async () => {
    if (!toolsAvailable) {
      return;
    }
    // resolveTarget calls queryUserOnSite — needs a real user on the site.
    const userId = process.env.UPDATE_USER_E2E_ID;
    if (!userId) {
      console.warn(
        'Skipping bogus-token assertion — set UPDATE_USER_E2E_ID to a real user LUID on the site.',
      );
      return;
    }
    let threw = false;
    try {
      await client.callTool('update-user', {
        schema: z.string(),
        toolArgs: {
          userId,
          siteRole: 'Unlicensed',
          confirm: true,
          confirmationToken: '00000000-0000-4000-8000-000000000000',
        },
      });
    } catch (e) {
      threw = true;
      expect(String(e)).toContain('could not verify that a preview ran');
    }
    expect(threw).toBe(true);
  });

  it('should update a disposable user via preview → confirm (opt-in, requires live endpoint)', async () => {
    if (!toolsAvailable) {
      return;
    }
    const disposableId = process.env.UPDATE_USER_E2E_ID;
    if (!disposableId) {
      console.warn(
        'Skipping mutating assertion — set UPDATE_USER_E2E_ID to a disposable user LUID.',
      );
      return;
    }

    const preview = await client.callTool('update-user', {
      schema: z.string(),
      toolArgs: { userId: disposableId, siteRole: 'Unlicensed' },
    });
    expect(preview).toContain('Preview');
    expect(preview).toContain('No change has been made');

    const tokenMatch = preview.match(
      /confirmationToken:\s*\\?"?([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/,
    );
    expect(tokenMatch).toBeTruthy();
    const token = tokenMatch![1];

    const message = await client.callTool('update-user', {
      schema: z.string(),
      toolArgs: {
        userId: disposableId,
        siteRole: 'Unlicensed',
        confirm: true,
        confirmationToken: token,
      },
    });

    expect(message).toContain('successfully updated');
  });
});
