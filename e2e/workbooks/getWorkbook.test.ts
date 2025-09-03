import { workbookSchema } from '../../src/sdks/tableau/types/workbook.js';
import { deleteConfigJsons, writeConfigJson } from '../configJson.js';
import { callTool } from '../startInspector.js';
import { getDefaultEnv, getSuperstoreWorkbook, resetEnv, setEnv } from '../testEnv.js';

describe('get-workbook', () => {
  beforeAll(() => deleteConfigJsons('get-workbook'));
  afterEach(() => deleteConfigJsons('get-workbook'));

  beforeAll(setEnv);
  afterAll(resetEnv);

  it('should get workbook', async () => {
    const env = getDefaultEnv();
    const superstore = getSuperstoreWorkbook(env);

    const { filename: configJson } = writeConfigJson({
      describe: 'get-workbook',
      env,
    });

    const workbook = await callTool('get-workbook', {
      configJson,
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
