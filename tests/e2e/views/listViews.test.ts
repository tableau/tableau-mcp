import z from 'zod';

import { viewSchema } from '../../../src/sdks/tableau/types/view.js';
import invariant from '../../../src/utils/invariant.js';
import { getDefaultEnv, getSuperstoreWorkbook, resetEnv, setEnv } from '../../testEnv.js';
import { callTool } from '../client.js';

describe('list-views', () => {
  beforeAll(setEnv);
  afterAll(resetEnv);

  it('should list views', async () => {
    const env = getDefaultEnv();
    const superstore = getSuperstoreWorkbook(env);

    const views = await callTool('list-views', {
      env,
      schema: z.array(viewSchema),
    });

    expect(views.length).greaterThan(0);
    const view = views.find((view) => view.id === superstore.defaultViewId);
    invariant(view, 'Default view for Superstore workbook not found');

    expect(view).toMatchObject({
      id: superstore.defaultViewId,
      name: 'Overview',
      workbook: {
        id: superstore.id,
      },
    });
  });

  it('should list views with filter', async () => {
    const env = getDefaultEnv();
    const superstore = getSuperstoreWorkbook(env);

    const views = await callTool('list-views', {
      env,
      schema: z.array(viewSchema),
      toolArgs: { filter: 'name:eq:Overview,workbookName:eq:Superstore' },
    });

    expect(views).toHaveLength(1);
    expect(views[0]).toMatchObject({
      id: superstore.defaultViewId,
      name: 'Overview',
      workbook: {
        id: superstore.id,
      },
    });
  });

  it('should list views with pageSize and limit', async () => {
    const views = await callTool('list-views', {
      schema: z.array(viewSchema),
      toolArgs: { pageSize: 5, limit: 10 },
    });

    expect(views).toHaveLength(10);
  });
});
