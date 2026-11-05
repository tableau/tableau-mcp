import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import * as loggerModule from '../../../logging/logger.js';
import { WebMcpServer } from '../../../server.web.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getCabuConversationStore } from './cabuConversationStore.js';
import { getCabuStartConversationTool } from './cabuStartConversation.js';
import { decodeUtteranceArgs } from './cabuUtteranceArgs.js';

const mocks = vi.hoisted(() => ({
  mockStartConversation: vi.fn(),
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

beforeEach(() => {
  vi.spyOn(loggerModule, 'log').mockImplementation(() => {});
});

describe('cabuStartConversationTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCabuConversationStore().clear();
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
      response: {
        conversationId: 'conversation-1',
        scope: 'tenant-123',
        datasources: [{ datasourceLuid: '11111111-1111-1111-1111-111111111111' }],
      },
      cookies: ['cabuCtx=abc123; Path=/'],
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

  it('seeds the conversation store with the minted cookies, keyed by conversationId', async () => {
    mocks.mockStartConversation.mockResolvedValue({
      response: { conversationId: 'conversation-2', scope: 'tenant-123', datasources: [] },
      cookies: ['cabuCtx=xyz789; Path=/'],
    });

    await getToolResult({ datasourceLuid: '11111111-1111-1111-1111-111111111111' });

    expect(getCabuConversationStore().get('conversation-2')).toMatchObject({
      cookies: ['cabuCtx=xyz789; Path=/'],
    });
  });

  it('returns a clear error when CES does not return a conversationId', async () => {
    mocks.mockStartConversation.mockResolvedValue({
      response: { scope: 'tenant-123', datasources: [] },
      cookies: [],
    });

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
});

async function getToolResult(params: any): Promise<CallToolResult> {
  const tool = getCabuStartConversationTool(new WebMcpServer());
  const callback = await Provider.from(tool.callback);
  return await callback(params, getMockRequestHandlerExtra());
}
