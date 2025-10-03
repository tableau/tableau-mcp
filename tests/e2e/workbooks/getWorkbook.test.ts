import { workbookSchema } from '../../../src/sdks/tableau/types/workbook.js';
import { getDefaultEnv, getSuperstoreWorkbook, resetEnv, setEnv } from '../../testEnv.js';
import { callTool } from '../client.js';

describe('get-workbook', () => {
  beforeAll(setEnv);
  afterAll(resetEnv);

  it('should get workbook', async () => {
    const env = getDefaultEnv();
    const superstore = getSuperstoreWorkbook(env);

    const workbook = await callTool('get-workbook', {
      env,
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
