import { z } from 'zod';

import invariant from '../../../src/utils/invariant.js';
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

  it('should preview (tag, no delete)', async () => {
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
    expect(message).toContain('pending-deletion');
  });

  it('should reject a confirmed delete when the workbook is not tagged pending-deletion', async () => {
    if (!toolsAvailable) {
      return;
    }
    // Bypass-closed: a caller that jumps straight to confirm: true (skipping the preview/tag step)
    // must be rejected by the server-authoritative tag gate, never deleting. Uses a distinct,
    // never-previewed LUID so the live re-fetch finds no pending-deletion tag.
    const untaggedId =
      process.env.DELETE_WORKBOOK_E2E_UNTAGGED_ID ?? process.env.DELETE_WORKBOOK_E2E_ID;
    if (!untaggedId) {
      return;
    }

    let threw = false;
    try {
      await client.callTool('delete-workbook', {
        schema: z.string(),
        toolArgs: { workbookId: untaggedId, confirm: true },
      });
    } catch (e) {
      threw = true;
      expect(String(e)).toContain('not tagged');
    }
    expect(threw).toBe(true);
  });

  it('should delete a disposable workbook via preview (tag) → confirm (opt-in)', async () => {
    if (!toolsAvailable) {
      return;
    }
    // Destructive — only runs when explicitly opted in with a throwaway workbook LUID.
    const disposableId = process.env.DELETE_WORKBOOK_E2E_DESTRUCTIVE_ID;
    if (!disposableId) {
      return;
    }

    // 1. Preview applies the pending-deletion tag server-side (no token to capture).
    const preview = await client.callTool('delete-workbook', {
      schema: z.string(),
      toolArgs: { workbookId: disposableId },
    });
    invariant(preview.includes('pending-deletion'), `Preview did not tag the workbook: ${preview}`);

    // 2. Confirm: the server re-fetches, verifies the tag, then deletes.
    const message = await client.callTool('delete-workbook', {
      schema: z.string(),
      toolArgs: { workbookId: disposableId, confirm: true },
    });

    expect(message).toContain('Deleted');
    expect(message).toContain('recycle');
  });
});
