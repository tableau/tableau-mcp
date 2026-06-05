import { z } from 'zod';

import { scheduleSchema } from '../../../src/sdks/tableau/types/schedule.js';
import invariant from '../../../src/utils/invariant.js';
import { getDefaultEnv, resetEnv, setEnv } from '../../testEnv.js';
import { McpClient } from '../mcpClient.js';

describe('list-schedules', () => {
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
    toolsAvailable = tools.includes('list-schedules');
    if (!toolsAvailable) {
      console.warn(
        'Skipping list-schedules e2e tests — admin tools not registered. ' +
          'Ensure ADMIN_TOOLS_ENABLED=true in tests/.env.',
      );
    }
  });

  afterAll(async () => {
    await client.close();
  });

  it('should return schedules or the empty-result message', async () => {
    if (!toolsAvailable) {
      return;
    }

    // The schedule list is derived from extract refresh tasks. On a site with no
    // tasks the tool returns the empty-result message (plain text) instead of a
    // JSON array, so we call the raw client and accept either shape.
    const result = await client.client.callTool({ name: 'list-schedules', arguments: {} });

    expect(result.isError).toBeFalsy();
    invariant(Array.isArray(result.content));
    expect(result.content).toHaveLength(1);
    const text = result.content[0].text;
    invariant(typeof text === 'string');

    if (text.startsWith('No schedules were found')) {
      expect(text).toContain('No schedules were found');
    } else {
      const schedules = z.array(scheduleSchema.passthrough()).parse(JSON.parse(text));
      schedules.forEach((schedule) => {
        expect(typeof schedule.taskCount).toBe('number');
      });
    }
  });
});
