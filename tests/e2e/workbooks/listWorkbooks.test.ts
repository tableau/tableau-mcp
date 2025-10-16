import z from 'zod';

import { workbookSchema } from '../../../src/sdks/tableau/types/workbook.js';
import { getDefaultEnv, getSuperstoreWorkbook, resetEnv, setEnv } from '../../testEnv.js';
import { callTool } from '../client.js';

describe('list-workbooks', () => {
  beforeAll(setEnv);
  afterAll(resetEnv);

  it('should list workbooks', async () => {
    const env = getDefaultEnv();
    const superstore = getSuperstoreWorkbook(env);

    const workbooks = await callTool('list-workbooks', {
      env,
      schema: z.array(workbookSchema),
    });

    expect(workbooks.length).greaterThan(0);
    const workbook = workbooks.find((workbook) => workbook.name === 'Superstore');

    expect(workbook).toMatchObject({
      id: superstore.id,
      name: 'Superstore',
      defaultViewId: superstore.defaultViewId,
    });
  });

  it('should list workbooks with filter', async () => {
    const env = getDefaultEnv();
    const superstore = getSuperstoreWorkbook(env);

    const workbooks = await callTool('list-workbooks', {
      env,
      schema: z.array(workbookSchema),
      toolArgs: { filter: 'name:eq:Super*' },
    });

    expect(workbooks).toHaveLength(1);
    expect(workbooks[0]).toMatchObject({
      id: superstore.id,
      name: 'Superstore',
      defaultViewId: superstore.defaultViewId,
    });
  });
});
