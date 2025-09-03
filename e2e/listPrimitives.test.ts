import { toolNames } from '../src/tools/toolName.js';
import { deleteConfigJsons, writeConfigJson } from './configJson.js';
import { listTools } from './startInspector.js';

describe('listPrimitives', () => {
  beforeAll(() => deleteConfigJsons('listPrimitives'));
  afterEach(() => deleteConfigJsons('listPrimitives'));

  it('should list tools', async () => {
    const { filename: configJson } = writeConfigJson({ describe: 'listPrimitives' });
    const names = await listTools(configJson);
    expect(names).toEqual(expect.arrayContaining(['query-datasource']));
    expect(names).toHaveLength(toolNames.length);
  });
});
