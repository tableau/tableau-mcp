import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { WebMcpServer } from '../../../server.web.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getResolveDatasourceLuidTool } from './resolveDatasourceLuid.js';

const mocks = vi.hoisted(() => ({
  mockListDatasources: vi.fn(),
  mockIsDatasourceAllowed: vi.fn(),
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

vi.mock('../resourceAccessChecker.js', () => ({
  resourceAccessChecker: {
    isDatasourceAllowed: mocks.mockIsDatasourceAllowed,
  },
}));

describe('resolveDatasourceLuid', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mockIsDatasourceAllowed.mockResolvedValue({ allowed: true });
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

  it('returns an indistinguishable "no match" error for an out-of-context datasource (no existence oracle)', async () => {
    mocks.mockListDatasources.mockResolvedValue({
      datasources: [{ id: '2', name: 'correct', contentUrl: 'GUS-Work' }],
    });
    mocks.mockIsDatasourceAllowed.mockResolvedValue({ allowed: false, message: 'nope' });
    const denied = await getToolResult('GUS-Work');

    // Absent contentUrl (no rows) — must look identical to the denied case.
    mocks.mockListDatasources.mockResolvedValue({ datasources: [] });
    mocks.mockIsDatasourceAllowed.mockResolvedValue({ allowed: true });
    const absent = await getToolResult('GUS-Work');

    expect(denied.isError).toBe(true);
    expect(absent.isError).toBe(true);
    invariant(denied.content[0].type === 'text');
    invariant(absent.content[0].type === 'text');
    expect(denied.content[0].text).toContain('No datasource matched contentUrl');
    expect(denied.content[0].text).toBe(absent.content[0].text);
    expect(mocks.mockIsDatasourceAllowed).toHaveBeenCalledWith(
      expect.objectContaining({ datasourceLuid: '2' }),
    );
  });

  it('rejects contentUrl values that break filter grammar', async () => {
    const result = await getToolResult('Sales,Ops');
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('Invalid filter expression format');
  });
});

async function getToolResult(contentUrl: string): Promise<CallToolResult> {
  const tool = getResolveDatasourceLuidTool(new WebMcpServer());
  const callback = await Provider.from(tool.callback);
  return await callback({ contentUrl }, getMockRequestHandlerExtra());
}
