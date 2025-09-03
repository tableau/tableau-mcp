import { ListToolsResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { startInspector } from './startInspector.js';
import { toolNames } from '../src/tools/toolName.js';
import { writeConfigJson } from './writeConfigJson.js';
import { globSync, unlinkSync } from 'fs';

describe('listTools', () => {
  beforeAll(deleteConfigJsons);
  afterEach(deleteConfigJsons);

  function deleteConfigJsons() {
    globSync('config.*.test.json').forEach(unlinkSync);
  }

  it('should list tools', async () => {
    const configJson = writeConfigJson({});

    const result = await startInspector(
      {
        '--config': configJson,
        '--server': 'tableau',
        '--method': 'tools/list',
      },
      ListToolsResultSchema,
    );

    const names = result.tools.map((tool) => tool.name);
    expect(names).toEqual(expect.arrayContaining([...toolNames]));
  });
});
