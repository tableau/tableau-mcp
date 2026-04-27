import z from 'zod';

import { customViewSchema } from '../../../src/sdks/tableau/types/customView.js';
import invariant from '../../../src/utils/invariant.js';
import { getDefaultEnv, getSuperstoreWorkbook, resetEnv, setEnv } from '../../testEnv.js';
import { McpClient } from '../mcpClient.js';

describe('list-custom-views', () => {
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

  it('should list custom views for a workbook', async () => {
    const env = getDefaultEnv();
    const superstore = getSuperstoreWorkbook(env);

    const customViews = await client.callTool('list-custom-views', {
      schema: z.array(customViewSchema),
      toolArgs: { workbookId: superstore.id },
    });

    expect(customViews.length).greaterThan(0);
    const customView = customViews.find(
      (customView) => customView.id === superstore.defaultView.customViewId,
    );
    invariant(customView, 'Custom view for Superstore workbook not found');

    expect(customView).toMatchObject({
      id: superstore.defaultView.customViewId,
      workbook: {
        id: superstore.id,
      },
      view: {
        id: superstore.defaultView.id,
      },
    });
  });

  it('should list custom views with filter', async () => {
    const env = getDefaultEnv();
    const superstore = getSuperstoreWorkbook(env);

    const customViews = await client.callTool('list-custom-views', {
      schema: z.array(customViewSchema),
      toolArgs: {
        workbookId: superstore.id,
        filter: `viewId:eq:${superstore.defaultView.id}`,
      },
    });

    expect(customViews).toHaveLength(1);
    expect(customViews[0]).toMatchObject({
      id: superstore.defaultView.customViewId,
      workbook: {
        id: superstore.id,
      },
      view: {
        id: superstore.defaultView.id,
      },
    });
  });

  it('should list custom views with pageSize and limit', async () => {
    const env = getDefaultEnv();
    const superstore = getSuperstoreWorkbook(env);

    const customViews = await client.callTool('list-custom-views', {
      schema: z.array(customViewSchema),
      toolArgs: { workbookId: superstore.id, pageSize: 5, limit: 10 },
    });

    expect(customViews).toHaveLength(1);
    expect(customViews[0]).toMatchObject({
      id: superstore.defaultView.customViewId,
      workbook: {
        id: superstore.id,
      },
      view: {
        id: superstore.defaultView.id,
      },
    });
  });
});
