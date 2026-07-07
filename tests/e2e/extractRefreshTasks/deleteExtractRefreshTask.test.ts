import { z } from 'zod';

import invariant from '../../../src/utils/invariant.js';
import { getDefaultEnv, resetEnv, setEnv } from '../../testEnv.js';
import { McpClient } from '../mcpClient.js';

/**
 * E2E coverage for the admin-only, destructive `delete-extract-refresh-task` tool.
 *
 * The actual DELETE is blocked on Tableau Cloud sessionless OAuth enablement (401 with PAT auth),
 * so only registration and schema-validation paths are tested here. The destructive leg is gated
 * behind DELETE_EXTRACT_REFRESH_TASK_E2E_ID — set it to a disposable task LUID once the endpoint
 * is enabled on your Cloud site.
 *
 * The tool is two-phase (preview→confirm): the first call (confirm omitted/false) deletes nothing
 * but returns a server-generated single-use confirmation token in its preview text; the second call
 * passes that token with confirm: true to perform the irreversible delete. This mirrors the
 * delete-workbook / delete-datasource e2e suites (those use a server-side tag; this tool uses a
 * server-authoritative registry nonce). A confirm with no prior preview (or a fabricated token) is
 * rejected server-side — a value cannot be computed to bypass the gate.
 */
describe('delete-extract-refresh-task', () => {
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
    toolsAvailable = tools.includes('delete-extract-refresh-task');
    if (!toolsAvailable) {
      console.warn(
        'Skipping delete-extract-refresh-task e2e tests — admin tools not registered. ' +
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
      expect(tools.includes('delete-extract-refresh-task')).toBe(false);
    } finally {
      await defaultClient.close();
    }
  });

  it('should reject an invalid (non-UUID) taskId at schema level', async () => {
    if (!toolsAvailable) {
      return;
    }

    let threw = false;
    try {
      await client.callTool('delete-extract-refresh-task', {
        schema: z.string(),
        toolArgs: { taskId: 'not-a-valid-uuid' },
      });
    } catch (e) {
      threw = true;
      expect(String(e)).toContain('uuid');
    }
    expect(threw).toBe(true);
  });

  it('should reject an empty taskId at schema level', async () => {
    if (!toolsAvailable) {
      return;
    }

    let threw = false;
    try {
      await client.callTool('delete-extract-refresh-task', {
        schema: z.string(),
        toolArgs: { taskId: '' },
      });
    } catch (e) {
      threw = true;
      expect(String(e)).toContain('uuid');
    }
    expect(threw).toBe(true);
  });

  it('should return a preview with a confirmationToken when confirm is omitted', async () => {
    // Exercises the preview leg of the two-phase contract end-to-end via a real MCP client.
    // No Tableau delete endpoint is called — the preview response is admin-gated and mints the
    // server-side nonce. The taskId does not need to exist on the site; preview echoes it verbatim.
    if (!toolsAvailable) {
      return;
    }
    const previewTaskId = 'a1b2c3d4-e5f6-4789-9abc-ef1234567890';
    const message = await client.callTool('delete-extract-refresh-task', {
      schema: z.string(),
      toolArgs: { taskId: previewTaskId },
    });
    expect(message).toContain('Preview');
    expect(message).toContain(previewTaskId);
    expect(message).toContain('confirmationToken:');
  });

  it('should reject a confirmed call with a bogus (never-previewed) confirmationToken', async () => {
    // No preview minted this token, so the server-authoritative gate cannot verify it and the
    // delete is rejected with zero side effects.
    if (!toolsAvailable) {
      return;
    }
    let threw = false;
    try {
      await client.callTool('delete-extract-refresh-task', {
        schema: z.string(),
        toolArgs: {
          taskId: 'a1b2c3d4-e5f6-4789-9abc-ef1234567890',
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

  it('should preview a disposable task without deleting it (opt-in, requires live endpoint)', async () => {
    if (!toolsAvailable) {
      return;
    }
    const previewId = process.env.DELETE_EXTRACT_REFRESH_TASK_E2E_ID;
    if (!previewId) {
      console.warn(
        'Skipping preview assertion — set DELETE_EXTRACT_REFRESH_TASK_E2E_ID to a disposable task LUID.',
      );
      return;
    }

    // Preview phase: confirm omitted. Nothing is deleted; the tool returns a single-use token.
    const message = await client.callTool('delete-extract-refresh-task', {
      schema: z.string(),
      toolArgs: { taskId: previewId },
    });

    expect(message).toContain('Preview');
    expect(message).toContain('confirmationToken:');
  });

  it('should reject a confirmed delete when no prior preview supplied a valid token', async () => {
    if (!toolsAvailable) {
      return;
    }
    // Bypass-closed: a caller that jumps straight to confirm: true with a fabricated/absent token
    // (skipping the preview step) must be rejected by the server-authoritative nonce gate, never
    // deleting. Uses a distinct, never-previewed LUID so no stored nonce matches.
    const untaggedId =
      process.env.DELETE_EXTRACT_REFRESH_TASK_E2E_UNTAGGED_ID ??
      process.env.DELETE_EXTRACT_REFRESH_TASK_E2E_ID;
    if (!untaggedId) {
      return;
    }

    let threw = false;
    try {
      await client.callTool('delete-extract-refresh-task', {
        schema: z.string(),
        toolArgs: {
          taskId: untaggedId,
          confirm: true,
          confirmationToken: '00000000-0000-4000-8000-000000000000',
        },
      });
    } catch (e) {
      threw = true;
      expect(String(e)).toContain('preview');
    }
    expect(threw).toBe(true);
  });

  it('should delete a disposable task via preview → confirm (opt-in, requires live endpoint)', async () => {
    if (!toolsAvailable) {
      return;
    }
    // Destructive — only runs when explicitly opted in with a throwaway task LUID.
    const disposableId = process.env.DELETE_EXTRACT_REFRESH_TASK_E2E_DESTRUCTIVE_ID;
    if (!disposableId) {
      return;
    }

    // 1. Preview: returns a single-use confirmation token embedded in the response text. No delete.
    const preview = await client.callTool('delete-extract-refresh-task', {
      schema: z.string(),
      toolArgs: { taskId: disposableId },
    });
    invariant(preview.includes('Preview'), `Preview did not run: ${preview}`);
    // The preview text echoes the token as a UUID: confirmationToken: "<uuid>". Use it verbatim
    // (rather than recomputing) — the caller is not supposed to derive this server nonce.
    const tokenMatch = preview.match(
      /confirmationToken:\s*\\?"?([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/,
    );
    invariant(tokenMatch, `Preview did not return a confirmation token: ${preview}`);
    const confirmationToken = tokenMatch[1];

    // 2. Confirm: pass the token from the preview; the server verifies and consumes it, then deletes.
    const message = await client.callTool('delete-extract-refresh-task', {
      schema: z.string(),
      toolArgs: { taskId: disposableId, confirm: true, confirmationToken },
    });

    expect(message).toContain('successfully deleted');
  });
});
