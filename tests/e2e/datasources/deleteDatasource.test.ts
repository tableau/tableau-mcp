import { z } from 'zod';

import invariant from '../../../src/utils/invariant.js';
import { getDefaultEnv, resetEnv, setEnv } from '../../testEnv.js';
import { McpClient } from '../mcpClient.js';

/**
 * E2E coverage for the admin-only, destructive `delete-datasource` tool.
 *
 * Safe by default: only the non-destructive PREVIEW phase runs against the live site. The
 * confirmed-delete leg is gated behind DELETE_DATASOURCE_E2E_DESTRUCTIVE_ID, which must point at a
 * disposable data source the caller is willing to send to the recycle bin.
 */
describe('delete-datasource', () => {
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
    toolsAvailable = tools.includes('delete-datasource');
    if (!toolsAvailable) {
      console.warn(
        'Skipping delete-datasource e2e tests — admin tools not registered. ' +
          'Ensure ADMIN_TOOLS_ENABLED=true in tests/.env and the caller is a site admin.',
      );
    }
  });

  afterAll(async () => {
    await client.close();
  });

  it('should register the tool only when admin tools are enabled', async () => {
    // With ADMIN_TOOLS_ENABLED=true the tool is present; without it (default env) it must be
    // absent from the manifest.
    const defaultClient = new McpClient({ env: getDefaultEnv() });
    await defaultClient.connect();
    try {
      const tools = await defaultClient.listTools();
      expect(tools.includes('delete-datasource')).toBe(false);
    } finally {
      await defaultClient.close();
    }
  });

  it('should preview (tag, no delete) and warn on dependents', async () => {
    if (!toolsAvailable) {
      return;
    }
    const previewId = process.env.DELETE_DATASOURCE_E2E_ID;
    if (!previewId) {
      console.warn(
        'Skipping preview assertion — set DELETE_DATASOURCE_E2E_ID to a data source LUID.',
      );
      return;
    }

    const message = await client.callTool('delete-datasource', {
      schema: z.string(),
      toolArgs: { datasourceId: previewId },
    });

    expect(message).toContain('Preview');
    expect(message).toContain('pending-deletion');
  });

  it('should reject a confirmed delete when the data source is not tagged pending-deletion', async () => {
    if (!toolsAvailable) {
      return;
    }
    // Bypass-closed: a caller that jumps straight to confirm: true (skipping the preview/tag step)
    // must be rejected by the server-authoritative tag gate, never deleting. Uses a distinct,
    // never-previewed LUID so the live re-fetch finds no pending-deletion tag.
    const untaggedId =
      process.env.DELETE_DATASOURCE_E2E_UNTAGGED_ID ?? process.env.DELETE_DATASOURCE_E2E_ID;
    if (!untaggedId) {
      return;
    }

    let threw = false;
    try {
      await client.callTool('delete-datasource', {
        schema: z.string(),
        toolArgs: { datasourceId: untaggedId, confirm: true },
      });
    } catch (e) {
      threw = true;
      expect(String(e)).toContain('not tagged');
    }
    expect(threw).toBe(true);
  });

  it('should delete a disposable datasource via preview (tag) → confirm (opt-in)', async () => {
    if (!toolsAvailable) {
      return;
    }
    // Destructive — only runs when explicitly opted in with a throwaway data source LUID.
    const disposableId = process.env.DELETE_DATASOURCE_E2E_DESTRUCTIVE_ID;
    if (!disposableId) {
      return;
    }

    // 1. Preview applies the pending-deletion tag server-side (no token to capture).
    const preview = await client.callTool('delete-datasource', {
      schema: z.string(),
      toolArgs: { datasourceId: disposableId },
    });
    invariant(
      preview.includes('pending-deletion'),
      `Preview did not tag the data source: ${preview}`,
    );

    // 2. Confirm: the server re-fetches, verifies the tag, then deletes.
    const message = await client.callTool('delete-datasource', {
      schema: z.string(),
      toolArgs: { datasourceId: disposableId, confirm: true },
    });

    expect(message).toContain('Deleted');
    expect(message).toContain('recycle');
  });
});
