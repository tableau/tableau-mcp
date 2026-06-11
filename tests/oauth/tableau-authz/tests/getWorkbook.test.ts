import { z } from 'zod';

import { workbookSchema } from '../../../../src/sdks/tableau/types/workbook.js';
import { expect, test } from './base.js';
import { getSuperstoreWorkbook } from './testEnv.js';

const appToolResultSchema = z.object({
  data: workbookSchema,
  url: z.string(),
});

test.describe('get-workbook', () => {
  test('get workbook', async ({ client }) => {
    const superstore = getSuperstoreWorkbook();

    const result = await client.callTool('get-workbook', {
      schema: appToolResultSchema,
      toolArgs: {
        workbookId: superstore.id,
      },
    });

    expect(result).toMatchObject({
      data: {
        id: superstore.id,
      },
      url: expect.any(String),
    });
  });
});
