import { workbookSchema } from '../../../../src/sdks/tableau/types/workbook';
import { expect, test } from './base';
import { getSuperstoreWorkbook } from './testEnv';

test.describe('get-workbook', () => {
  test('get workbook', async ({ client }) => {
    const superstore = getSuperstoreWorkbook();

    const workbook = await client.callTool('get-workbook', {
      schema: workbookSchema,
      toolArgs: {
        workbookId: superstore.id,
      },
    });

    expect(workbook).toMatchObject(superstore);
  });
});
