import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { WebMcpServer } from '../../../server.web.js';
import { stubDefaultEnvVars } from '../../../testShared.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getResolveDatasourceLuidTool } from './resolveDatasourceLuid.js';

const mocks = vi.hoisted(() => ({ mockListDatasources: vi.fn() }));

vi.mock('../../../restApiInstance.js', () => ({
  useRestApi: vi.fn().mockImplementation(async ({ callback }) =>
    callback({
      siteId: 'site-1',
      datasourcesMethods: { listDatasources: mocks.mockListDatasources },
    }),
  ),
}));

const proj = (name: string): { id: string; name: string } => ({ id: `p-${name}`, name });
const tags = { tag: [] };

// The case-insensitive server filter returns BOTH "Superstore" and "superstore".
const superstoreCaseCollision = [
  {
    id: '78667ee4',
    name: 'Superstore',
    contentUrl: 'Superstore',
    project: proj('Tableau Samples'),
    tags,
  },
  {
    id: 'e27f64e8',
    name: 'Superstore',
    contentUrl: 'superstore',
    project: proj('Personal Work'),
    tags,
  },
];

describe('getResolveDatasourceLuidTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    stubDefaultEnvVars();
    mocks.mockListDatasources.mockResolvedValue({
      pagination: { pageNumber: '1', pageSize: '100', totalAvailable: '2' },
      datasources: superstoreCaseCollision,
    });
  });

  it('has the correct tool name', () => {
    const tool = getResolveDatasourceLuidTool(new WebMcpServer());
    expect(tool.name).toBe('resolve-datasource-luid');
  });

  it('exact case-sensitive match resolves the unique LUID despite case-insensitive filter', async () => {
    const result = await run({ contentUrl: 'Superstore' });
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const payload = JSON.parse(result.content[0].text);
    expect(payload.luid).toBe('78667ee4');
    expect(payload.contentUrl).toBe('Superstore');
    expect(payload.projectName).toBe('Tableau Samples');
  });

  it('lowercase contentUrl resolves the other datasource', async () => {
    const result = await run({ contentUrl: 'superstore' });
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    expect(JSON.parse(result.content[0].text).luid).toBe('e27f64e8');
  });

  it('returns not-found for an unknown contentUrl', async () => {
    const result = await run({ contentUrl: 'DoesNotExist' });
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('No published datasource found');
  });

  async function run(args: { contentUrl: string; projectName?: string }): Promise<CallToolResult> {
    const tool = getResolveDatasourceLuidTool(new WebMcpServer());
    const callback = await Provider.from(tool.callback);
    return await callback(args, getMockRequestHandlerExtra());
  }
});
