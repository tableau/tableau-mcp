import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import * as loggerModule from '../../../logging/logger.js';
import { WebMcpServer } from '../../../server.web.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { WebTool } from '../tool.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getCabuAskTool } from './cabuAsk.js';
import { getCabuStartConversationTool } from './cabuStartConversation.js';

const mocks = vi.hoisted(() => ({
  mockStartConversation: vi.fn(),
  mockAskUtterance: vi.fn(),
  mockStreamUtterance: vi.fn(),
}));

// A fresh RestApi per call, as in production: nothing is shared between tool calls except what
// the caller passes back.
vi.mock('../../../restApiInstance.js', () => ({
  useRestApi: vi.fn().mockImplementation(async ({ callback }) =>
    callback({
      cabuMethods: {
        startConversation: mocks.mockStartConversation,
        askUtterance: mocks.mockAskUtterance,
        streamUtterance: mocks.mockStreamUtterance,
      },
      siteId: 'test-site-id',
    }),
  ),
}));

const DATASOURCE_LUID = '11111111-1111-1111-1111-111111111111';

describe('a Tableau Agent conversation across tool calls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(loggerModule, 'log').mockImplementation(() => {});
  });

  it('continues from the start output alone, with no server-side session', async () => {
    mocks.mockStartConversation.mockResolvedValue({
      conversationId: 'conversation-1',
      scope: 'tenant-123',
      datasources: [{ datasourceLuid: DATASOURCE_LUID }],
    });
    mocks.mockAskUtterance
      .mockResolvedValueOnce({ utteranceId: 'utterance-1' })
      .mockResolvedValueOnce({ utteranceId: 'utterance-2' });
    mocks.mockStreamUtterance
      .mockResolvedValueOnce({
        status: 'complete',
        responseComplete: {
          node: 'response',
          response: 'Total sales were $1,000,000.',
          chatLuid: 'aaaaaaaa-1111-2222-3333-444444444444',
        },
      })
      .mockResolvedValueOnce({
        status: 'complete',
        responseComplete: { node: 'response', response: 'West sales were $400,000.' },
      });

    // Each call gets its own server and tool instance, so no in-process state can carry over.
    const started = parse(
      await call(getCabuStartConversationTool(new WebMcpServer()), {
        datasourceLuid: DATASOURCE_LUID,
      }),
    );
    const turn1 = parse(
      await call(getCabuAskTool(new WebMcpServer()), {
        conversationToken: started.conversationToken,
        question: 'What were total sales?',
      }),
    );
    const turn2 = parse(
      await call(getCabuAskTool(new WebMcpServer()), {
        conversationToken: started.conversationToken,
        question: 'Now just the West region.',
        parentLuid: turn1.nextParentLuid,
      }),
    );

    expect(turn2.response).toBe('West sales were $400,000.');
    const expectedBody = {
      localization: { locale: 'en-US', language: 'en' },
      scope: 'tenant-123',
      datasources: [{ datasourceLuid: DATASOURCE_LUID }],
      embedded: false,
    };
    expect(mocks.mockAskUtterance).toHaveBeenNthCalledWith(1, 'conversation-1', {
      ...expectedBody,
      utterance: { content: 'What were total sales?', source: 'user' },
      parentLuid: undefined,
    });
    expect(mocks.mockAskUtterance).toHaveBeenNthCalledWith(2, 'conversation-1', {
      ...expectedBody,
      utterance: { content: 'Now just the West region.', source: 'user' },
      parentLuid: 'aaaaaaaa-1111-2222-3333-444444444444',
    });
  });
});

async function call(tool: WebTool<any>, params: any): Promise<CallToolResult> {
  const callback = await Provider.from(tool.callback);
  return await callback(params, getMockRequestHandlerExtra());
}

function parse(result: CallToolResult): Record<string, string> {
  expect(result.isError).toBe(false);
  invariant(result.content[0].type === 'text');
  return JSON.parse(result.content[0].text);
}
