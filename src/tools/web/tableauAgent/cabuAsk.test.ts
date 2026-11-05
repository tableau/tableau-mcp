import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import * as loggerModule from '../../../logging/logger.js';
import { WebMcpServer } from '../../../server.web.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getCabuAskTool } from './cabuAsk.js';
import { encodeUtteranceArgs } from './cabuUtteranceArgs.js';

const mocks = vi.hoisted(() => ({
  mockAskUtterance: vi.fn(),
  mockStreamUtterance: vi.fn(),
}));

vi.mock('../../../restApiInstance.js', () => ({
  useRestApi: vi.fn().mockImplementation(async ({ callback }) =>
    callback({
      cabuMethods: {
        askUtterance: mocks.mockAskUtterance,
        streamUtterance: mocks.mockStreamUtterance,
      },
      siteId: 'test-site-id',
    }),
  ),
}));

beforeEach(() => {
  vi.spyOn(loggerModule, 'log').mockImplementation(() => {});
});

const VALID_UTTERANCE_ARGS = encodeUtteranceArgs({
  scope: 'tenant-123',
  datasources: [{ datasourceLuid: '11111111-1111-1111-1111-111111111111' }],
  localization: { locale: 'en-US', language: 'en' },
  embedded: false,
});

describe('cabuAskTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create a tool instance with correct properties', () => {
    const tool = getCabuAskTool(new WebMcpServer());
    expect(tool.name).toBe('cabu-ask');
    expect(tool.paramsSchema).toMatchObject({
      conversationId: expect.any(Object),
      utteranceArgs: expect.any(Object),
      question: expect.any(Object),
      parentLuid: expect.any(Object),
    });
  });

  it('returns a clear error when utteranceArgs is invalid or corrupted', async () => {
    const result = await getToolResult({
      conversationId: 'conversation-1',
      utteranceArgs: 'not-a-valid-token',
      question: 'What were total sales?',
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toMatch(/utteranceArgs.*invalid|corrupt/i);
    expect(mocks.mockAskUtterance).not.toHaveBeenCalled();
  });

  it('asks a question and returns the assembled answer, passing only conversationId and the decoded utteranceArgs fields', async () => {
    mocks.mockAskUtterance.mockResolvedValue({ utteranceId: 'utterance-1' });
    mocks.mockStreamUtterance.mockResolvedValue({
      status: 'complete',
      responseComplete: {
        node: 'response',
        response: 'Sales were highest in the West region.',
        chatLuid: 'aaaaaaaa-1111-2222-3333-444444444444',
      },
    });

    const result = await getToolResult({
      conversationId: 'conversation-1',
      utteranceArgs: VALID_UTTERANCE_ARGS,
      question: 'Which region had the highest sales?',
    });

    expect(result.isError).toBe(false);
    expect(mocks.mockAskUtterance).toHaveBeenCalledWith('conversation-1', {
      utterance: { content: 'Which region had the highest sales?', source: 'user' },
      localization: { locale: 'en-US', language: 'en' },
      scope: 'tenant-123',
      datasources: [{ datasourceLuid: '11111111-1111-1111-1111-111111111111' }],
      parentLuid: undefined,
      embedded: false,
    });
    expect(mocks.mockStreamUtterance).toHaveBeenCalledWith('conversation-1', 'utterance-1');

    invariant(result.content[0].type === 'text');
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.response).toBe('Sales were highest in the West region.');
    expect(parsed.nextParentLuid).toBe('aaaaaaaa-1111-2222-3333-444444444444');
  });

  it('threads parentLuid across two simulated turns', async () => {
    mocks.mockAskUtterance.mockResolvedValueOnce({ utteranceId: 'utterance-1' });
    mocks.mockStreamUtterance.mockResolvedValueOnce({
      status: 'complete',
      responseComplete: {
        node: 'response',
        response: 'Total sales were $1,000,000.',
        chatLuid: 'aaaaaaaa-1111-2222-3333-444444444444',
      },
    });

    const turn1 = await getToolResult({
      conversationId: 'conversation-1',
      utteranceArgs: VALID_UTTERANCE_ARGS,
      question: 'What were total sales?',
    });
    invariant(turn1.content[0].type === 'text');
    const turn1Parsed = JSON.parse(turn1.content[0].text);

    expect(mocks.mockAskUtterance).toHaveBeenNthCalledWith(
      1,
      'conversation-1',
      expect.objectContaining({ parentLuid: undefined }),
    );

    mocks.mockAskUtterance.mockResolvedValueOnce({ utteranceId: 'utterance-2' });
    mocks.mockStreamUtterance.mockResolvedValueOnce({
      status: 'complete',
      responseComplete: {
        node: 'response',
        response: 'In the West region, sales were $400,000.',
        chatLuid: 'bbbbbbbb-1111-2222-3333-444444444444',
      },
    });

    const turn2 = await getToolResult({
      conversationId: 'conversation-1',
      utteranceArgs: VALID_UTTERANCE_ARGS,
      question: 'Now just the West region.',
      parentLuid: turn1Parsed.nextParentLuid,
    });
    invariant(turn2.content[0].type === 'text');
    const turn2Parsed = JSON.parse(turn2.content[0].text);

    // Turn 2 must have threaded turn 1's nextParentLuid forward as this turn's parentLuid --
    // conversation continuity itself is carried by CES server-side (keyed by conversationId), not
    // by anything replayed from this process.
    expect(mocks.mockAskUtterance).toHaveBeenNthCalledWith(
      2,
      'conversation-1',
      expect.objectContaining({ parentLuid: 'aaaaaaaa-1111-2222-3333-444444444444' }),
    );
    expect(mocks.mockStreamUtterance).toHaveBeenNthCalledWith(2, 'conversation-1', 'utterance-2');
    expect(turn2Parsed.response).toBe('In the West region, sales were $400,000.');
  });

  it('maps a stream error event to a clear error', async () => {
    mocks.mockAskUtterance.mockResolvedValue({ utteranceId: 'utterance-1' });
    mocks.mockStreamUtterance.mockResolvedValue({
      status: 'error',
      error: { error_code: 'WAII_TIMEOUT', error_details: 'The model timed out.' },
    });

    const result = await getToolResult({
      conversationId: 'conversation-1',
      utteranceArgs: VALID_UTTERANCE_ARGS,
      question: 'What were total sales?',
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('WAII_TIMEOUT');
    expect(result.content[0].text).toContain('The model timed out.');
  });

  it('maps an incomplete stream (no terminal event) to a clear error', async () => {
    mocks.mockAskUtterance.mockResolvedValue({ utteranceId: 'utterance-1' });
    mocks.mockStreamUtterance.mockResolvedValue({ status: 'incomplete' });

    const result = await getToolResult({
      conversationId: 'conversation-1',
      utteranceArgs: VALID_UTTERANCE_ARGS,
      question: 'What were total sales?',
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toMatch(/stream ended before completing/i);
  });

  it('maps a response_complete event carrying an error_code to a clear error, even on a complete stream', async () => {
    mocks.mockAskUtterance.mockResolvedValue({ utteranceId: 'utterance-1' });
    mocks.mockStreamUtterance.mockResolvedValue({
      status: 'complete',
      responseComplete: {
        node: 'response',
        error_code: 'WAII_NO_DATA',
        error_details: 'No data matched the question.',
      },
    });

    const result = await getToolResult({
      conversationId: 'conversation-1',
      utteranceArgs: VALID_UTTERANCE_ARGS,
      question: 'What were total sales?',
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('WAII_NO_DATA');
  });
});

async function getToolResult(params: any): Promise<CallToolResult> {
  const tool = getCabuAskTool(new WebMcpServer());
  const callback = await Provider.from(tool.callback);
  return await callback(params, getMockRequestHandlerExtra());
}
