import { ListToolsResultSchema } from '@modelcontextprotocol/sdk/types.js';

import { toolNames } from '../src/tools/toolName.js';
import { startInspector } from './startInspector.js';
import { deleteConfigJsons } from './testConfig.js';
import { writeConfigJson } from './writeConfigJson.js';

describe('listPrimitives', () => {
  beforeAll(() => deleteConfigJsons('listPrimitives'));
  afterEach(() => deleteConfigJsons('listPrimitives'));

  it('should list tools', async () => {
    const { filename: configJson } = writeConfigJson({ describe: 'listPrimitives' });

    const result = await startInspector(
      {
        '--config': configJson,
        '--server': 'tableau',
        '--method': 'tools/list',
      },
      ListToolsResultSchema,
    );

    const names = result.tools.map((tool) => tool.name);
    expect(names).toEqual(expect.arrayContaining(['query-datasource']));
    expect(names).toHaveLength(toolNames.length);
  });
});
