import { toolNames } from '../../../../src/tools/toolName';
import { expect, test } from './base';

test.describe('oauth', () => {
  test('list tools', async ({ client }) => {
    const { tools } = await client.listTools();
    const names = tools.map((tool) => tool.name);
    expect(names).toEqual(expect.arrayContaining([...toolNames]));
    expect(names).toHaveLength(toolNames.length);
  });
});
