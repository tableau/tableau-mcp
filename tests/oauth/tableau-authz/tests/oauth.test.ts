import { expect, test } from './base.js';

test.describe('oauth', () => {
  test('list tools', async ({ client }) => {
    const { tools } = await client.listTools();
    const names = tools.map((tool) => tool.name);
    expect(names).toContain('query-datasource');
  });
});
