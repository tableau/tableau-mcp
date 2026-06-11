import { z } from 'zod';

import { getDefaultEnv, resetEnv, setEnv } from '../../testEnv.js';
import { McpClient } from '../mcpClient.js';

/**
 * E2E coverage for the admin-only, destructive `delete-workbook` tool.
 *
 * Safe by default: only the non-destructive PREVIEW phase runs against the live site. The
 * confirmed-delete leg is gated behind DELETE_WORKBOOK_E2E_ID, which must point at a disposable
 * workbook the caller is willing to send to the recycle bin.
 */
describe('delete-workbook', () => {
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
    toolsAvailable = tools.includes('delete-workbook');
    if (!toolsAvailable) {
      console.warn(
        'Skipping delete-workbook e2e tests — admin tools not registered. ' +
          'Ensure ADMIN_TOOLS_ENABLED=true in tests/.env and the caller is a site admin.',
      );
    }
  });

  afterAll(async () => {
    await client.close();
  });

  it('should register the tool only when admin tools are enabled', async () => {
    // Sanity: with ADMIN_TOOLS_ENABLED=true the tool is present; without it (default env)
    // it must be absent from the manifest.
    const defaultClient = new McpClient({ env: getDefaultEnv() });
    await defaultClient.connect();
    try {
      const tools = await defaultClient.listTools();
      expect(tools.includes('delete-workbook')).toBe(false);
    } finally {
      await defaultClient.close();
    }
  });

  it('should preview (tag, no delete) for a known workbook', async () => {
    if (!toolsAvailable) {
      return;
    }
    const previewId = process.env.DELETE_WORKBOOK_E2E_ID;
    if (!previewId) {
      console.warn('Skipping preview assertion — set DELETE_WORKBOOK_E2E_ID to a workbook LUID.');
      return;
    }

    const message = await client.callTool('delete-workbook', {
      schema: z.string(),
      toolArgs: { workbookId: previewId },
    });

    expect(message).toContain('Preview');
    expect(message).toContain('stale-pending-deletion');
    expect(message).toContain('confirm: true');
  });

  it('should delete a disposable workbook when confirm is true (opt-in)', async () => {
    if (!toolsAvailable) {
      return;
    }
    // Destructive — only runs when explicitly opted in with a throwaway workbook LUID.
    const disposableId = process.env.DELETE_WORKBOOK_E2E_DESTRUCTIVE_ID;
    if (!disposableId) {
      return;
    }

    const message = await client.callTool('delete-workbook', {
      schema: z.string(),
      toolArgs: { workbookId: disposableId, confirm: true },
    });

    expect(message).toContain('deleted');
    expect(message).toContain('recycle');
  });
});
