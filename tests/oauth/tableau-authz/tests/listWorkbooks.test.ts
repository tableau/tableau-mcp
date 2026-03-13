import z from 'zod';

import { workbookSchema } from '../../../../src/sdks/tableau/types/workbook';
import { expect, test } from './base';
import { getSuperstoreWorkbook } from './testEnv';

// Skip until Content Exploration issues are resolved
test.describe.skip('list-workbooks', () => {
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
