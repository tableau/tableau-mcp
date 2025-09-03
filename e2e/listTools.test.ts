import { ListToolsResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { globSync, unlinkSync } from 'fs';

import { toolNames } from '../src/tools/toolName.js';
import { startInspector } from './startInspector.js';
import { writeConfigJson } from './writeConfigJson.js';

describe('listTools', () => {
  beforeAll(deleteConfigJsons);
  afterEach(deleteConfigJsons);

  function deleteConfigJsons(): void {
    const configJsons = globSync('config.*.test.json');
    configJsons.forEach(unlinkSync);
  }

  it('should list tools', async () => {
    const { filename: configJson } = writeConfigJson({ describe: 'listTools', env: {} });

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
