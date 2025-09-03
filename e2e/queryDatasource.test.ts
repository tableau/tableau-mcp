import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';

import { QueryOutput } from '../src/sdks/tableau/apis/vizqlDataServiceApi.js';
import invariant from '../src/utils/invariant.js';
import { deleteConfigJsons, writeConfigJson } from './configJson.js';
import { startInspector } from './startInspector.js';
import { getDefaultEnv, getSuperstoreDatasource, resetEnv, setEnv } from './testEnv.js';

describe('query-datasource', () => {
  beforeAll(() => deleteConfigJsons('query-datasource'));
  afterEach(() => deleteConfigJsons('query-datasource'));

  beforeAll(setEnv);
  afterAll(resetEnv);

  it('should query datasource', async ({ skip }) => {
    skip(
      'Tool arguments in JSON format not supported yet: https://github.com/modelcontextprotocol/inspector/pull/647',
    );

    const env = getDefaultEnv();
    const superstore = getSuperstoreDatasource(env);

    const { filename: configJson } = writeConfigJson({
      describe: 'query-datasource',
      env,
    });

    const result = await startInspector(
      {
        '--config': configJson,
        '--server': 'tableau',
        '--method': 'tools/call',
        '--tool-name': 'query-datasource',
        '--tool-args': {
          datasourceLuid: superstore.id,
          query: { fields: [{ fieldCaption: 'Postal Code' }] },
        },
      },
      CallToolResultSchema,
    );

    expect(result.isError).toBe(false);
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe('text');

    const text = result.content[0].text;
    invariant(typeof text === 'string');
    const output = QueryOutput.parse(JSON.parse(text));
    console.log(output);
  });
});
