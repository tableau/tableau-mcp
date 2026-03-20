import { z } from 'zod';

import { workbookSchema } from '../../../../src/sdks/tableau/types/workbook.js';
import { expect, test } from './base.js';
import { getSuperstoreWorkbook } from './testEnv.js';

test.describe('list-workbooks', () => {
  test('list workbooks', async ({ client }) => {
    const superstore = getSuperstoreWorkbook();

    const workbooks = await client.callTool('list-workbooks', {
      schema: z.array(workbookSchema),
      toolArgs: {},
    });

    expect(workbooks.length).toBeGreaterThan(0);
    const workbook = workbooks.find((workbook) => workbook.name === 'Superstore');

    expect(workbook).toMatchObject(superstore);
  });
});
