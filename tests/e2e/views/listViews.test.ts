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

    const { data: views } = await client.callTool('list-views', {
      schema: z.object({ data: z.array(viewSchema), totalAvailable: z.number() }),
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

    const { data: views } = await client.callTool('list-views', {
      schema: z.object({ data: z.array(viewSchema), totalAvailable: z.number() }),
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

  it('should list views with pageNumber and limit', async () => {
    const { data: views } = await client.callTool('list-views', {
      schema: z.object({ data: z.array(viewSchema), totalAvailable: z.number() }),
      toolArgs: { pageNumber: 1, limit: 10 },
    });

    expect(views.length).toBeLessThanOrEqual(10);
  });
});
