import z from 'zod';

import { workbookSchema } from '../../../src/sdks/tableau/types/workbook.js';
import { getDefaultEnv, getSuperstoreWorkbook, resetEnv, setEnv } from '../../testEnv.js';
import { McpClient } from '../mcpClient.js';

describe('list-workbooks', () => {
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

  it('should list workbooks', async () => {
    const env = getDefaultEnv();
    const superstore = getSuperstoreWorkbook(env);

    const { data: workbooks } = await client.callTool('list-workbooks', {
      schema: z.object({ data: z.array(workbookSchema), totalAvailable: z.number() }),
    });

    expect(workbooks.length).greaterThan(0);
    const workbook = workbooks.find((workbook) => workbook.name === 'Superstore');

    expect(workbook).toMatchObject({
      id: superstore.id,
      name: 'Superstore',
      defaultViewId: superstore.defaultView.id,
    });
  });

  it('should list workbooks with filter', async () => {
    const env = getDefaultEnv();
    const superstore = getSuperstoreWorkbook(env);

    const { data: workbooks } = await client.callTool('list-workbooks', {
      schema: z.object({ data: z.array(workbookSchema), totalAvailable: z.number() }),
      toolArgs: { filter: 'name:eq:Superstore' },
    });

    expect(workbooks.length).greaterThan(0);
    const workbook = workbooks.find((candidate) => candidate.name === 'Superstore');

    expect(workbook).toMatchObject({
      id: superstore.id,
      name: 'Superstore',
      defaultViewId: superstore.defaultView.id,
    });
  });
});
