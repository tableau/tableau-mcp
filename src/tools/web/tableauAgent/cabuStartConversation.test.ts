import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { AxiosError } from 'axios';

import * as loggerModule from '../../../logging/logger.js';
import { WebMcpServer } from '../../../server.web.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { decodeConversationToken } from './cabuConversationToken.js';
import { getCabuStartConversationTool } from './cabuStartConversation.js';

const mocks = vi.hoisted(() => ({
  mockStartConversation: vi.fn(),
  mockWaitForSampling: vi.fn(),
  mockQueryDatasource: vi.fn(),
  mockQueryWorkbookConnections: vi.fn(),
  mockIsFeatureEnabled: vi.fn(),
}));

vi.mock('../../../restApiInstance.js', () => ({
  useRestApi: vi.fn().mockImplementation(async ({ callback }) =>
    callback({
      cabuMethods: {
        startConversation: mocks.mockStartConversation,
        waitForSampling: mocks.mockWaitForSampling,
      },
      datasourcesMethods: {
        queryDatasource: mocks.mockQueryDatasource,
      },
      workbooksMethods: {
        queryWorkbookConnections: mocks.mockQueryWorkbookConnections,
      },
      siteId: 'test-site-id',
    }),
  ),
}));

vi.mock('../../../features/init.js', () => ({
  getFeatureGate: vi.fn(() => ({ isFeatureEnabled: mocks.mockIsFeatureEnabled })),
}));

beforeEach(() => {
  vi.spyOn(loggerModule, 'log').mockImplementation(() => {});
});

describe('cabuStartConversationTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('should create a tool instance with correct properties', () => {
    const tool = getCabuStartConversationTool(new WebMcpServer());
    expect(tool.name).toBe('tableau-agent-start-conversation');
    expect(tool.paramsSchema).toMatchObject({
      datasourceLuid: expect.any(Object),
    });
  });

  it('starts a conversation and returns one opaque conversationToken', async () => {
    mocks.mockStartConversation.mockResolvedValue({
      conversationId: 'conversation-1',
      scope: 'tenant-123',
      datasources: [{ datasourceLuid: '11111111-1111-1111-1111-111111111111' }],
    });

    const result = await getToolResult({ datasourceLuid: '11111111-1111-1111-1111-111111111111' });

    expect(result.isError).toBe(false);
    expect(mocks.mockStartConversation).toHaveBeenCalledWith({
      dashboardDatasources: [{ datasourceLuid: '11111111-1111-1111-1111-111111111111' }],
      embedded: false,
    });

    invariant(result.content[0].type === 'text');
    const parsed = JSON.parse(result.content[0].text);
    expect(Object.keys(parsed)).toEqual(['conversationToken']);
    expect(mocks.mockWaitForSampling).not.toHaveBeenCalled();
    expect(decodeConversationToken(parsed.conversationToken)).toEqual({
      conversationId: 'conversation-1',
      scope: 'tenant-123',
      datasources: [{ datasourceLuid: '11111111-1111-1111-1111-111111111111' }],
      localization: { locale: 'en-US', language: 'en' },
      embedded: false,
    });
  });

  describe('with a workbookLuid', () => {
    const datasourceLuid = '11111111-1111-1111-1111-111111111111';
    const workbookLuid = '22222222-2222-2222-2222-222222222222';

    beforeEach(() => {
      mocks.mockQueryDatasource.mockResolvedValue({ id: datasourceLuid, name: 'Superstore' });
      mocks.mockStartConversation.mockResolvedValue({
        conversationId: 'conversation-1',
        scope: 'tenant-123',
        datasources: [{ datasourceLuid, vdsDatasourceLuid: 'embedded-copy-luid' }],
      });
      mocks.mockWaitForSampling.mockResolvedValue({ status: 'complete' });
      mocks.mockQueryWorkbookConnections.mockResolvedValue([
        { id: 'connection-1', datasource: { id: 'embedded-copy-luid', name: 'Superstore' } },
      ]);
    });

    it('sends the workbook and the datasource name CES matches its connection by', async () => {
      // An embedded copy of a published datasource has its own id but keeps the published name.
      mocks.mockQueryWorkbookConnections.mockResolvedValue([
        { id: 'connection-1', datasource: { id: 'embedded-copy-luid', name: 'Superstore' } },
      ]);

      const result = await getToolResult({ datasourceLuid, workbookLuid });

      expect(result.isError).toBe(false);
      expect(mocks.mockQueryWorkbookConnections).toHaveBeenCalledWith({
        siteId: 'test-site-id',
        workbookId: workbookLuid,
      });
      expect(mocks.mockStartConversation).toHaveBeenCalledWith({
        workbookLuid,
        dashboardDatasources: [{ datasourceLuid, name: 'Superstore' }],
        embedded: false,
      });
    });

    it('waits for field sampling before returning, so the session outlives it', async () => {
      const result = await getToolResult({ datasourceLuid, workbookLuid });

      expect(result.isError).toBe(false);
      expect(mocks.mockWaitForSampling).toHaveBeenCalledWith('conversation-1', expect.any(Number));
    });

    it('does not wait when CES resolved no data source to sample', async () => {
      mocks.mockStartConversation.mockResolvedValue({
        conversationId: 'conversation-1',
        scope: 'tenant-123',
        datasources: [{ datasourceLuid, vdsDatasourceLuid: null }],
      });

      const result = await getToolResult({ datasourceLuid, workbookLuid });

      expect(result.isError).toBe(false);
      expect(mocks.mockWaitForSampling).not.toHaveBeenCalled();
    });

    it.each([
      ['fails', () => mocks.mockWaitForSampling.mockRejectedValue(new Error('403'))],
      ['times out', () => mocks.mockWaitForSampling.mockResolvedValue({ status: 'incomplete' })],
    ])('still returns the conversation when sampling %s', async (_, arrange) => {
      arrange();

      const result = await getToolResult({ datasourceLuid, workbookLuid });

      expect(result.isError).toBe(false);
      invariant(result.content[0].type === 'text');
      const { conversationToken } = JSON.parse(result.content[0].text);
      expect(decodeConversationToken(conversationToken).conversationId).toBe('conversation-1');
    });

    it('returns an error and starts no conversation when the workbook does not use the datasource', async () => {
      mocks.mockQueryWorkbookConnections.mockResolvedValue([
        { id: 'connection-1', datasource: { id: 'other-luid', name: 'Medicare-Claims' } },
      ]);

      const result = await getToolResult({ datasourceLuid, workbookLuid });

      expect(result.isError).toBe(true);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain('does not connect to the data source "Superstore"');
      expect(mocks.mockStartConversation).not.toHaveBeenCalled();
    });

    it('returns a workbook-not-allowed error when the workbook is outside tool-scoping', async () => {
      vi.stubEnv('INCLUDE_WORKBOOK_IDS', 'some-other-workbook-luid');

      const result = await getToolResult({ datasourceLuid, workbookLuid });

      expect(result.isError).toBe(true);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain(
        `Querying the workbook with LUID ${workbookLuid} is not allowed.`,
      );
      expect(mocks.mockStartConversation).not.toHaveBeenCalled();
    });
  });

  it('returns a clear error when CES does not return a conversationId', async () => {
    mocks.mockStartConversation.mockResolvedValue({ scope: 'tenant-123', datasources: [] });

    const result = await getToolResult({ datasourceLuid: '11111111-1111-1111-1111-111111111111' });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('conversationId');
  });

  it('handles API errors gracefully', async () => {
    mocks.mockStartConversation.mockRejectedValue(new Error('CES unavailable'));

    const result = await getToolResult({ datasourceLuid: '11111111-1111-1111-1111-111111111111' });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('CES unavailable');
  });

  it('maps a CES 403 to a Tableau-Agent-not-enabled error', async () => {
    mocks.mockStartConversation.mockRejectedValue(
      new AxiosError('Forbidden', '403', undefined, undefined, { status: 403 } as never),
    );

    const result = await getToolResult({ datasourceLuid: '11111111-1111-1111-1111-111111111111' });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('Tableau Agent is most likely not enabled');
  });

  it('returns a datasource-not-allowed error and never starts a conversation when the datasource is outside tool-scoping', async () => {
    vi.stubEnv('INCLUDE_DATASOURCE_IDS', 'some-other-datasource-luid');

    const result = await getToolResult({ datasourceLuid: '11111111-1111-1111-1111-111111111111' });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain(
      'Querying the datasource with LUID 11111111-1111-1111-1111-111111111111 is not allowed.',
    );
    expect(mocks.mockStartConversation).not.toHaveBeenCalled();
  });

  it.each([
    [true, true, false],
    [true, false, false],
    [false, true, true],
    [false, false, true],
  ])(
    'TABLEAU_AGENT_TOOLS_ENABLED=%s, tableau-agent-tools flag=%s → disabled=%s',
    async (tableauAgentToolsEnabled, flag, disabled) => {
      vi.stubEnv('TABLEAU_AGENT_TOOLS_ENABLED', String(tableauAgentToolsEnabled));
      mocks.mockIsFeatureEnabled.mockImplementation(
        async (featureName: string) => flag && featureName === 'tableau-agent-tools',
      );
      try {
        const tool = getCabuStartConversationTool(new WebMcpServer());
        expect(await Provider.from(tool.disabled)).toBe(disabled);
      } finally {
        vi.stubEnv('TABLEAU_AGENT_TOOLS_ENABLED', undefined);
      }
    },
  );

  it('defers to the tableau-agent-tools feature flag when TABLEAU_AGENT_TOOLS_ENABLED is unset', async () => {
    mocks.mockIsFeatureEnabled.mockResolvedValue(true);

    const tool = getCabuStartConversationTool(new WebMcpServer());
    expect(await Provider.from(tool.disabled)).toBe(false);
    expect(mocks.mockIsFeatureEnabled).toHaveBeenCalledWith('tableau-agent-tools');
  });
});

async function getToolResult(params: any): Promise<CallToolResult> {
  const tool = getCabuStartConversationTool(new WebMcpServer());
  const callback = await Provider.from(tool.callback);
  return await callback(params, getMockRequestHandlerExtra());
}
