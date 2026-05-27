import { webToolNames } from '../../../../src/tools/web/toolName.js';
import { expect, test } from './base.js';

const ADMIN_GATED_TOOL_NAMES: ReadonlyArray<string> = [
  'query-admin-insights-ts-events',
  'query-admin-insights-site-content',
  'get-stale-content-report',
];

test.describe('oauth', () => {
  test('list tools', async ({ client }) => {
    const { tools } = await client.listTools();
    const names = tools.map((tool) => tool.name);
    const adminToolsEnabled = process.env.TMCP_ADMIN_TOOLS_ENABLED === 'true';
    const expectedNames = adminToolsEnabled
      ? [...webToolNames]
      : webToolNames.filter((name) => !ADMIN_GATED_TOOL_NAMES.includes(name));
    expect(names).toEqual(expect.arrayContaining(expectedNames));
    expect(names).toHaveLength(expectedNames.length);
  });
});
