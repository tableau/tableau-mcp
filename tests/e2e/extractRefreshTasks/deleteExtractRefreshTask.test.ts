import { z } from 'zod';

import { getDefaultEnv, resetEnv, setEnv } from '../../testEnv.js';
import { McpClient } from '../mcpClient.js';

/**
 * E2E coverage for the admin-only, destructive `delete-extract-refresh-task` tool.
 *
 * The actual DELETE is blocked on Tableau Cloud sessionless OAuth enablement (401 with PAT auth),
 * so only registration and schema-validation paths are tested here. The destructive leg is gated
 * behind DELETE_EXTRACT_REFRESH_TASK_E2E_ID — set it to a disposable task LUID once the endpoint
 * is enabled on your Cloud site.
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

  it('should return a preview with confirmationToken when confirm is omitted', async () => {
    // Exercises the preview leg of the two-phase contract end-to-end via a real MCP client.
    // No Tableau delete endpoint is called — the preview response is admin-gated only. The
    // taskId does not need to exist on the site; the preview echoes it verbatim.
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

  it('should reject a confirmed call with a mismatched confirmationToken', async () => {
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
          confirmationToken: 'deadbeefcafe',
        },
      });
    } catch (e) {
      threw = true;
      expect(String(e)).toContain('confirmationToken returned by the preview step');
    }
    expect(threw).toBe(true);
  });

  it('should delete a disposable task (opt-in, requires live endpoint)', async () => {
    // Runs the full two-phase flow end-to-end: preview → extract token → confirm. Requires the
    // delete endpoint to be reachable with the configured auth, hence env-gated. Uses the preview
    // response's token verbatim (rather than recomputing) to keep the client honest.
    if (!toolsAvailable) {
      return;
    }
    const disposableId = process.env.DELETE_EXTRACT_REFRESH_TASK_E2E_ID;
    if (!disposableId) {
      console.warn(
        'Skipping destructive delete — set DELETE_EXTRACT_REFRESH_TASK_E2E_ID to a disposable task LUID.',
      );
      return;
    }

    const preview = await client.callTool('delete-extract-refresh-task', {
      schema: z.string(),
      toolArgs: { taskId: disposableId },
    });
    expect(preview).toContain('Preview');
    const tokenMatch = preview.match(/confirmationToken:\s*([a-f0-9]{12})/);
    expect(tokenMatch).not.toBeNull();
    const token = tokenMatch![1];

    const message = await client.callTool('delete-extract-refresh-task', {
      schema: z.string(),
      toolArgs: {
        taskId: disposableId,
        confirm: true,
        confirmationToken: token,
      },
    });

    expect(message).toContain('successfully deleted');
  });
});
