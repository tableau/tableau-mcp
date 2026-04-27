import z from 'zod';

import { viewSchema } from '../../../src/sdks/tableau/types/view.js';
import invariant from '../../../src/utils/invariant.js';
import { getDefaultEnv, getSuperstoreWorkbook, resetEnv, setEnv } from '../../testEnv.js';
import { McpClient } from '../mcpClient.js';

describe('list-views', () => {
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

  it('should list views', async () => {
    const env = getDefaultEnv();
    const superstore = getSuperstoreWorkbook(env);

    const views = await client.callTool('list-views', {
      schema: z.array(viewSchema),
    });

    expect(views.length).greaterThan(0);
    const view = views.find((view) => view.id === superstore.defaultView.id);
    invariant(view, 'Default view for Superstore workbook not found');

    expect(view).toMatchObject({
      id: superstore.defaultView.id,
      name: 'Overview',
      workbook: {
        id: superstore.id,
      },
    });
  });

  it('should list views with filter', async () => {
    const env = getDefaultEnv();
    const superstore = getSuperstoreWorkbook(env);

    const views = await client.callTool('list-views', {
      schema: z.array(viewSchema),
      toolArgs: { filter: 'name:eq:Overview,workbookName:eq:Superstore' },
    });

    expect(views).toHaveLength(1);
    expect(views[0]).toMatchObject({
      id: superstore.defaultView.id,
      name: 'Overview',
      workbook: {
        id: superstore.id,
      },
    });
  });

  it('should list views with pageSize and limit', async () => {
    const views = await client.callTool('list-views', {
      schema: z.array(viewSchema),
      toolArgs: { pageSize: 5, limit: 10 },
    });

    expect(views).toHaveLength(10);
  });
});
