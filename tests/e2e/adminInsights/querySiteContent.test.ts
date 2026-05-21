import { z } from 'zod';

import { getDefaultEnv, resetEnv, setEnv } from '../../testEnv.js';
import { McpClient } from '../mcpClient.js';

const queryOutputSchema = z
  .object({
    data: z.array(z.record(z.string(), z.unknown())).optional(),
  })
  .passthrough();

describe('query-admin-insights-site-content', () => {
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
    toolsAvailable = tools.includes('query-admin-insights-site-content');
    if (!toolsAvailable) {
      console.warn(
        'Skipping query-admin-insights-site-content e2e tests — admin tools not registered. ' +
          'Ensure TMCP_ADMIN_TOOLS_ENABLED=true in tests/.env and the test site has Admin Insights enabled.',
      );
    }
  });

  afterAll(async () => {
    await client.close();
  });

  it('should query Site Content with the documented field captions', async () => {
    if (!toolsAvailable) {
      return;
    }
    const result = await client.callTool('query-admin-insights-site-content', {
      schema: queryOutputSchema,
      toolArgs: {
        query: {
          fields: [
            { fieldCaption: 'Item ID' },
            { fieldCaption: 'Item Type' },
            { fieldCaption: 'Item Name' },
            { fieldCaption: 'Item Parent Project Name' },
            { fieldCaption: 'Last Accessed At' },
            { fieldCaption: 'Created At' },
          ],
          filters: [
            {
              field: { fieldCaption: 'Item Type' },
              filterType: 'SET',
              values: ['Workbook', 'Datasource'],
              exclude: false,
            },
          ],
        },
        limit: 5,
      },
    });
    expect(result).toBeDefined();
    expect(Array.isArray(result.data ?? [])).toBe(true);
    const rows = result.data ?? [];
    if (rows.length > 0) {
      expect(rows[0]).toHaveProperty('Item ID');
      expect(rows[0]).toHaveProperty('Item Name');
    }
  });
});
