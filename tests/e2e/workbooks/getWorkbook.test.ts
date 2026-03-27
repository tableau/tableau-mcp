import { workbookSchema } from '../../../src/sdks/tableau/types/workbook.js';
import { getSuperstoreWorkbook, setEnv } from '../../testEnv.js';
import { callTool } from '../client.js';

describe('get-workbook', () => {
  beforeAll(setEnv);

  it('should get workbook', async () => {
    const superstore = getSuperstoreWorkbook();

    const workbook = await callTool('get-workbook', {
      schema: workbookSchema,
      toolArgs: { workbookId: superstore.id },
    });

    expect(workbook).toMatchObject({
      id: superstore.id,
      name: 'Superstore',
      defaultViewId: superstore.defaultViewId,
    });
  });
});
