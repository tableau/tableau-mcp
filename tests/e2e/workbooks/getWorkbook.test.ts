import { workbookSchema } from '../../../src/sdks/tableau/types/workbook.js';
import { getDefaultEnv, getSuperstoreWorkbook, resetEnv, setEnv } from '../../testEnv.js';
import { McpClient } from '../mcpClient.js';

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

    const workbook = await client.callTool('get-workbook', {
      schema: workbookSchema,
      toolArgs: { workbookId: superstore.id },
    });

    expect(workbook).toMatchObject({
      id: superstore.id,
      name: 'Superstore',
      defaultViewId: superstore.defaultView.id,
    });
  });
});
