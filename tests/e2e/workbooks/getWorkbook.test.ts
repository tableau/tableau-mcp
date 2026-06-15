import { z } from 'zod';

import { workbookSchema } from '../../../src/sdks/tableau/types/workbook.js';
import { getDefaultEnv, getSuperstoreWorkbook, resetEnv, setEnv } from '../../testEnv.js';
import { McpClient } from '../mcpClient.js';

const appToolResultSchema = z.object({
  data: workbookSchema,
  url: z.string(),
});

describe('get-workbook', () => {
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

  it('should get workbook', async () => {
    const env = getDefaultEnv();
    const superstore = getSuperstoreWorkbook(env);

    const result = await client.callTool('get-workbook', {
      schema: appToolResultSchema,
      toolArgs: { workbookId: superstore.id },
    });

    expect(result).toMatchObject({
      data: {
        id: superstore.id,
        name: 'Superstore',
        defaultViewId: superstore.defaultView.id,
      },
      url: expect.any(String),
    });
  });
});
