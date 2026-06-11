import { viewSchema } from '../../../src/sdks/tableau/types/view.js';
import { getDefaultEnv, getSuperstoreWorkbook, resetEnv, setEnv } from '../../testEnv.js';
import { McpClient } from '../mcpClient.js';

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

    const view = await client.callTool('get-view', {
      schema: viewSchema,
      toolArgs: { viewId: superstore.defaultView.id },
    });

    expect(view).toMatchObject({
      id: superstore.defaultView.id,
      name: 'Overview',
      workbook: {
        id: superstore.id,
      },
    });
  });
});
