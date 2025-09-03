import { QueryOutput } from '../src/sdks/tableau/apis/vizqlDataServiceApi.js';
import { deleteConfigJsons, writeConfigJson } from './configJson.js';
import { callTool } from './startInspector.js';
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

    const output = await callTool({
      configJson,
      toolName: 'query-datasource',
      schema: QueryOutput,
      toolArgs: {
        datasourceLuid: superstore.id,
        query: { fields: [{ fieldCaption: 'Postal Code' }] },
      },
    });

    console.log(output);
  });
});
