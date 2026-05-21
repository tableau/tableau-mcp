import { z } from 'zod';

import { getDefaultEnv, resetEnv, setEnv } from '../../testEnv.js';
import { McpClient } from '../mcpClient.js';

const queryOutputSchema = z
  .object({
    data: z.array(z.unknown()).optional(),
  })
  .passthrough();

describe('query-admin-insights-ts-events', () => {
  let client: McpClient;
  let toolsAvailable = false;

  beforeAll(setEnv);
  afterAll(resetEnv);

  beforeAll(async () => {
    client = new McpClient({
      env: { ...getDefaultEnv(), TMCP_ADMIN_TOOLS_ENABLED: 'true' },
    });
    await client.connect();
    const tools = await client.listTools();
    toolsAvailable = tools.includes('query-admin-insights-ts-events');
    if (!toolsAvailable) {
      console.warn(
        'Skipping query-admin-insights-ts-events e2e tests — admin tools not registered. ' +
          'Ensure TMCP_ADMIN_TOOLS_ENABLED=true in tests/.env and the test site has Admin Insights enabled.',
      );
    }
  });

  afterAll(async () => {
    await client.close();
  });

  it('should query TS Events with a minimal field selection', async () => {
    if (!toolsAvailable) {
      return;
    }
    const result = await client.callTool('query-admin-insights-ts-events', {
      schema: queryOutputSchema,
      toolArgs: {
        query: {
          fields: [{ fieldCaption: 'Item Id' }, { fieldCaption: 'Item Type' }],
        },
        limit: 10,
      },
    });
    expect(result).toBeDefined();
    expect(Array.isArray(result.data ?? [])).toBe(true);
  });
});
