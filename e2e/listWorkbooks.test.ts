import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import z from 'zod';

import { workbookSchema } from '../src/sdks/tableau/types/workbook.js';
import invariant from '../src/utils/invariant.js';
import { deleteConfigJsons, writeConfigJson } from './configJson.js';
import { startInspector } from './startInspector.js';
import { getDefaultEnv, getSuperstoreWorkbook, resetEnv, setEnv } from './testEnv.js';

describe('list-workbooks', () => {
  beforeAll(() => deleteConfigJsons('list-workbooks'));
  afterEach(() => deleteConfigJsons('list-workbooks'));

  beforeAll(setEnv);
  afterAll(resetEnv);

  it('should list workbooks', async () => {
    const env = getDefaultEnv();
    const superstore = getSuperstoreWorkbook(env);

    const { filename: configJson } = writeConfigJson({
      describe: 'list-workbooks',
      env,
    });

    const result = await startInspector(
      {
        '--config': configJson,
        '--server': 'tableau',
        '--method': 'tools/call',
        '--tool-name': 'list-workbooks',
      },
      CallToolResultSchema,
    );

    expect(result.isError).toBe(false);
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe('text');

    const text = result.content[0].text;
    invariant(typeof text === 'string');
    const workbooks = z.array(workbookSchema).parse(JSON.parse(text));

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

    const { filename: configJson } = writeConfigJson({
      describe: 'list-workbooks',
      env,
    });

    const result = await startInspector(
      {
        '--config': configJson,
        '--server': 'tableau',
        '--method': 'tools/call',
        '--tool-name': 'list-workbooks',
        '--tool-args': { filter: 'name:eq:Super*' },
      },
      CallToolResultSchema,
    );

    expect(result.isError).toBe(false);
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe('text');

    const text = result.content[0].text;
    invariant(typeof text === 'string');
    const workbooks = z.array(workbookSchema).parse(JSON.parse(text));

    expect(workbooks).toHaveLength(1);
    expect(workbooks[0]).toMatchObject({
      id: superstore.id,
      name: 'Superstore',
      defaultViewId: superstore.defaultViewId,
    });
  });
});
