import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import * as loggerModule from '../../../logging/logger.js';
import { WebMcpServer } from '../../../server.web.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getCabuStartConversationTool } from './cabuStartConversation.js';
import { decodeUtteranceArgs } from './cabuUtteranceArgs.js';

const mocks = vi.hoisted(() => ({
  mockStartConversation: vi.fn(),
  mockIsFeatureEnabled: vi.fn(),
}));

vi.mock('../../../restApiInstance.js', () => ({
  useRestApi: vi.fn().mockImplementation(async ({ callback }) =>
    callback({
      cabuMethods: {
        startConversation: mocks.mockStartConversation,
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
    expect(tool.name).toBe('cabu-start-conversation');
    expect(tool.paramsSchema).toMatchObject({
      datasourceLuid: expect.any(Object),
    });
  });

  it('starts a conversation and returns a conversationId plus an opaque utteranceArgs token', async () => {
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
    expect(parsed.conversationId).toBe('conversation-1');
    expect(typeof parsed.utteranceArgs).toBe('string');
    expect(decodeUtteranceArgs(parsed.utteranceArgs)).toEqual({
      scope: 'tenant-123',
      datasources: [{ datasourceLuid: '11111111-1111-1111-1111-111111111111' }],
      localization: { locale: 'en-US', language: 'en' },
      embedded: false,
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
