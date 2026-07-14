import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { WebMcpServer } from '../../../server.web.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getResolveDatasourceLuidTool } from './resolveDatasourceLuid.js';

const mocks = vi.hoisted(() => ({
  mockListDatasources: vi.fn(),
}));

vi.mock('../../../restApiInstance.js', () => ({
  useRestApi: vi.fn().mockImplementation(async ({ callback }) =>
    callback({
      siteId: 'test-site-id',
      datasourcesMethods: {
        listDatasources: mocks.mockListDatasources,
      },
    }),
  ),
}));

describe('resolveDatasourceLuid', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns exact case-sensitive contentUrl match', async () => {
    mocks.mockListDatasources.mockResolvedValue({
      datasources: [
        { id: '1', name: 'wrong', contentUrl: 'gus-work' },
        { id: '2', name: 'correct', contentUrl: 'GUS-Work' },
      ],
    });

    const result = await getToolResult('GUS-Work');
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.id).toBe('2');
  });

  it('returns error when no exact match found', async () => {
    mocks.mockListDatasources.mockResolvedValue({
      datasources: [{ id: '1', name: 'only', contentUrl: 'gus-work' }],
    });

    const result = await getToolResult('GUS-Work');
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('No datasource matched contentUrl');
  });
});

async function getToolResult(contentUrl: string): Promise<CallToolResult> {
  const tool = getResolveDatasourceLuidTool(new WebMcpServer());
  const callback = await Provider.from(tool.callback);
  return await callback({ contentUrl }, getMockRequestHandlerExtra());
}
