import { z } from 'zod';

import { viewSchema } from '../../../src/sdks/tableau/types/view.js';
import { getDefaultEnv, getSuperstoreWorkbook, resetEnv, setEnv } from '../../testEnv.js';
import { McpClient } from '../mcpClient.js';

const appToolResultSchema = z.object({
  data: viewSchema,
  url: z.string(),
});

describe('get-view', () => {
  let client: McpClient;

  beforeAll(setEnv);
  afterAll(resetEnv);

  beforeAll(async () => {
    client = new McpClient();
    await client.connect();
  });

  afterAll(async () => {
    await client.close();
  });

  it('should get view', async () => {
    const env = getDefaultEnv();
    const superstore = getSuperstoreWorkbook(env);

    const result = await client.callTool('get-view', {
      schema: appToolResultSchema,
      toolArgs: { viewId: superstore.defaultView.id },
    });

    expect(result).toMatchObject({
      data: {
        id: superstore.defaultView.id,
        name: 'Overview',
        workbook: {
          id: superstore.id,
        },
      },
      url: expect.any(String),
    });
  });
});
