import { z } from 'zod';

import { getDefaultEnv, resetEnv, setEnv } from '../../testEnv.js';
import { McpClient } from '../mcpClient.js';

/**
 * E2E coverage for the admin-only, mutating `update-cloud-extract-refresh-task` tool.
 *
 * Like `delete-extract-refresh-task`, the actual POST is blocked on Tableau Cloud sessionless OAuth
 * enablement (401 with PAT auth), so only registration and schema-validation paths are tested here.
 * The mutating leg is gated behind `UPDATE_CLOUD_EXTRACT_REFRESH_TASK_E2E_ID` — set it to a
 * disposable task LUID once the endpoint is enabled on your Cloud site.
 */
describe('update-cloud-extract-refresh-task', () => {
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
    toolsAvailable = tools.includes('update-cloud-extract-refresh-task');
    if (!toolsAvailable) {
      console.warn(
        'Skipping update-cloud-extract-refresh-task e2e tests — admin tools not registered. ' +
          'Ensure ADMIN_TOOLS_ENABLED=true in tests/.env and the caller is a site admin.',
      );
    }
  });

  afterAll(async () => {
    await client.close();
  });

  const validSchedule = {
    frequency: 'Weekly',
    frequencyDetails: {
      start: '06:00:00',
      intervals: { interval: [{ weekDay: 'Sunday' }] },
    },
  } as const;

  it('should register the tool only when admin tools are enabled', async () => {
    const defaultClient = new McpClient({ env: getDefaultEnv() });
    await defaultClient.connect();
    try {
      const tools = await defaultClient.listTools();
      expect(tools.includes('update-cloud-extract-refresh-task')).toBe(false);
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
      await client.callTool('update-cloud-extract-refresh-task', {
        schema: z.string(),
        toolArgs: { taskId: 'not-a-valid-uuid', schedule: validSchedule },
      });
    } catch (e) {
      threw = true;
      expect(String(e)).toContain('uuid');
    }
    expect(threw).toBe(true);
  });

  it('should reject an invalid frequency at schema level', async () => {
    if (!toolsAvailable) {
      return;
    }

    let threw = false;
    try {
      await client.callTool('update-cloud-extract-refresh-task', {
        schema: z.string(),
        toolArgs: {
          taskId: 'a1b2c3d4-e5f6-4789-9abc-ef1234567890',
          schedule: {
            frequency: 'Quarterly',
            frequencyDetails: { start: '06:00:00' },
          },
        },
      });
    } catch (e) {
      threw = true;
      expect(String(e).toLowerCase()).toMatch(/frequency|enum|invalid/);
    }
    expect(threw).toBe(true);
  });

  it('should return a preview with confirmationToken when confirm is omitted', async () => {
    // Exercises the preview leg of the two-phase contract end-to-end via a real MCP client.
    // No Tableau update endpoint is called — the preview response is admin-gated + zod-validated
    // only. The taskId does not need to exist on the site; the preview echoes it verbatim.
    if (!toolsAvailable) {
      return;
    }
    const previewTaskId = 'a1b2c3d4-e5f6-4789-9abc-ef1234567890';
    const message = await client.callTool('update-cloud-extract-refresh-task', {
      schema: z.string(),
      toolArgs: { taskId: previewTaskId, schedule: validSchedule },
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
      await client.callTool('update-cloud-extract-refresh-task', {
        schema: z.string(),
        toolArgs: {
          taskId: 'a1b2c3d4-e5f6-4789-9abc-ef1234567890',
          schedule: validSchedule,
          confirm: true,
          confirmationToken: 'deadbeefcafe',
        },
      });
    } catch (e) {
      threw = true;
      expect(String(e)).toContain('taskId + schedule pair');
    }
    expect(threw).toBe(true);
  });

  it('should update a disposable task (opt-in, requires live endpoint)', async () => {
    // Runs the full two-phase flow end-to-end: preview → extract token → confirm. Requires the
    // update endpoint to be reachable with the configured auth, hence env-gated. Uses the preview
    // response's token verbatim (rather than recomputing) to keep the client honest — the caller
    // is not supposed to derive the token itself.
    if (!toolsAvailable) {
      return;
    }
    const disposableId = process.env.UPDATE_CLOUD_EXTRACT_REFRESH_TASK_E2E_ID;
    if (!disposableId) {
      console.warn(
        'Skipping mutating update — set UPDATE_CLOUD_EXTRACT_REFRESH_TASK_E2E_ID to a disposable task LUID.',
      );
      return;
    }

    const preview = await client.callTool('update-cloud-extract-refresh-task', {
      schema: z.string(),
      toolArgs: { taskId: disposableId, schedule: validSchedule },
    });
    expect(preview).toContain('Preview');
    const tokenMatch = preview.match(/confirmationToken:\s*([a-f0-9]{12})/);
    expect(tokenMatch).not.toBeNull();
    const token = tokenMatch![1];

    const message = await client.callTool('update-cloud-extract-refresh-task', {
      schema: z.string(),
      toolArgs: {
        taskId: disposableId,
        schedule: validSchedule,
        confirm: true,
        confirmationToken: token,
      },
    });

    expect(message).toContain('successfully updated');
  });
});
