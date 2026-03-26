import dotenv from 'dotenv';
import z from 'zod';

import { workbookSchema } from '../../../src/sdks/tableau/types/workbook.js';
import { getSuperstoreWorkbook } from '../../testEnv.js';
import { callTool } from '../client.js';

describe('list-workbooks', () => {
  beforeAll(() => {
    dotenv.config();
  });

  it('should list workbooks', async () => {
    const superstore = getSuperstoreWorkbook();

    const workbooks = await callTool('list-workbooks', {
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
    const superstore = getSuperstoreWorkbook();

    const workbooks = await callTool('list-workbooks', {
      schema: z.array(workbookSchema),
      toolArgs: { filter: 'name:eq:Superstore' },
    });

    expect(workbooks.length).greaterThan(0);
    const workbook = workbooks.find((candidate) => candidate.name === 'Superstore');

    expect(workbook).toMatchObject({
      id: superstore.id,
      name: 'Superstore',
      defaultViewId: superstore.defaultViewId,
    });
  });
});
