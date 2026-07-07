import { z } from 'zod';

import invariant from '../../../src/utils/invariant.js';
import { getDefaultEnv, resetEnv, setEnv } from '../../testEnv.js';
import { McpClient } from '../mcpClient.js';

/**
 * E2E coverage for the admin-only, mutating `update-cloud-extract-refresh-task` tool.
 *
 * Like `delete-extract-refresh-task`, the actual POST is blocked on Tableau Cloud sessionless OAuth
 * enablement (401 with PAT auth), so only registration and schema-validation paths are tested here.
 * The mutating leg is gated behind `UPDATE_CLOUD_EXTRACT_REFRESH_TASK_E2E_ID` — set it to a
 * disposable task LUID once the endpoint is enabled on your Cloud site.
 *
 * This tool is two-phase with a server-authoritative preview→confirm gate: the first call (confirm
 * omitted/false) reports the schedule that would be applied, changes nothing, and returns a
 * server-generated single-use `confirmationToken` bound to this exact taskId + schedule. The second
 * call passes `confirm: true` plus that token; the server verifies and consumes it before applying.
 * A confirm with no prior preview (or a token minted for a different schedule) is rejected.
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

  it('should return a preview with a confirmationToken when confirm is omitted', async () => {
    // Exercises the preview leg of the two-phase contract end-to-end via a real MCP client.
    // No Tableau update endpoint is called — the preview response is admin-gated + zod-validated
    // and mints the server-side nonce. The taskId does not need to exist; preview echoes it.
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
    expect(message).toContain('No change has been made');
    expect(message).toContain('confirmationToken:');
  });

  it('should reject a confirmed call with a bogus (never-previewed) confirmationToken', async () => {
    // No preview ran for this token, so the server-authoritative gate cannot verify it and the
    // update is rejected with zero side effects — a value cannot be computed to bypass the gate.
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
          confirmationToken: '00000000-0000-4000-8000-000000000000',
        },
      });
    } catch (e) {
      threw = true;
      expect(String(e)).toContain('could not verify that a preview ran');
    }
    expect(threw).toBe(true);
  });

  it('should preview a disposable task without changing it (opt-in, requires live endpoint)', async () => {
    if (!toolsAvailable) {
      return;
    }
    const previewId = process.env.UPDATE_CLOUD_EXTRACT_REFRESH_TASK_E2E_ID;
    if (!previewId) {
      console.warn(
        'Skipping preview assertion — set UPDATE_CLOUD_EXTRACT_REFRESH_TASK_E2E_ID to a disposable task LUID.',
      );
      return;
    }

    // Preview phase: confirm omitted. The tool reports the schedule that would be applied and
    // changes nothing.
    const message = await client.callTool('update-cloud-extract-refresh-task', {
      schema: z.string(),
      toolArgs: { taskId: previewId, schedule: validSchedule },
    });

    expect(message).toContain('Preview');
    expect(message).toContain('No change has been made');
    expect(message).toContain('confirmationToken:');
  });

  it('should update a disposable task via preview → confirm (opt-in, requires live endpoint)', async () => {
    if (!toolsAvailable) {
      return;
    }
    // Mutating — only runs when explicitly opted in with a throwaway task LUID.
    const disposableId = process.env.UPDATE_CLOUD_EXTRACT_REFRESH_TASK_E2E_DESTRUCTIVE_ID;
    if (!disposableId) {
      return;
    }

    // 1. Preview: confirm omitted. Reports the would-be schedule and mints the token; nothing
    // changes. Use the preview response's token verbatim (rather than recomputing) — the caller is
    // not supposed to derive the token itself, and for this tool it is an unguessable server nonce.
    const preview = await client.callTool('update-cloud-extract-refresh-task', {
      schema: z.string(),
      toolArgs: { taskId: disposableId, schedule: validSchedule },
    });
    invariant(preview.includes('No change has been made'), `Preview applied a change: ${preview}`);
    const tokenMatch = preview.match(
      /confirmationToken:\s*\\?"?([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/,
    );
    invariant(tokenMatch, `Preview did not surface a confirmationToken: ${preview}`);
    const token = tokenMatch[1];

    // 2. Confirm: confirm: true plus the previewed token. The server verifies and consumes it,
    // then applies the schedule.
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
