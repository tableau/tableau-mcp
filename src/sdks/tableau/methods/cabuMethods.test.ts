import { Readable } from 'stream';
import { describe, expect, it, vi } from 'vitest';

import CabuMethods from './cabuMethods.js';

function fakeStream(chunks: Array<string>): Readable {
  const stream = new Readable({ read() {} });
  for (const chunk of chunks) {
    stream.push(Buffer.from(chunk));
  }
  stream.push(null);
  return stream;
}

const makeMethods = (): CabuMethods =>
  new CabuMethods(
    'https://tableau.example/content-exploration/analytics-assistant/cabu',
    { type: 'Bearer', token: 'token' },
    {},
  );

describe('CabuMethods.startConversation', () => {
  it('posts the conversation request and returns the parsed response with captured cookies', async () => {
    const cabuMethods = makeMethods();
    const post = vi.fn().mockResolvedValue({
      data: {
        conversationId: 'conv-1',
        scope: 'tenant-1',
        datasources: [{ datasourceLuid: 'ds-1', datasourceName: 'Superstore' }],
        b3TraceId: 'trace-1',
      },
      headers: { 'set-cookie': ['cabuCtx=abc123; Path=/; HttpOnly'] },
    });
    // @ts-expect-error - Replacing the Axios client for transport configuration coverage.
    cabuMethods._apiClient.axios.post = post;

    const result = await cabuMethods.startConversation({
      dashboardDatasources: [{ datasourceLuid: 'ds-1' }],
    });

    expect(result).toEqual({
      response: {
        conversationId: 'conv-1',
        scope: 'tenant-1',
        datasources: [{ datasourceLuid: 'ds-1', datasourceName: 'Superstore' }],
        b3TraceId: 'trace-1',
      },
      cookies: ['cabuCtx=abc123; Path=/; HttpOnly'],
    });
    expect(post).toHaveBeenCalledWith(
      '/conversations',
      { dashboardDatasources: [{ datasourceLuid: 'ds-1' }] },
      { headers: { Authorization: 'Bearer token' } },
    );
  });

  it('returns an empty cookie list when the response has no set-cookie header', async () => {
    const cabuMethods = makeMethods();
    const post = vi.fn().mockResolvedValue({
      data: { conversationId: 'conv-1', scope: 'tenant-1', datasources: [], b3TraceId: 'trace-1' },
      headers: {},
    });
    // @ts-expect-error - Replacing the Axios client for transport configuration coverage.
    cabuMethods._apiClient.axios.post = post;

    const result = await cabuMethods.startConversation({ dashboardDatasources: [] });

    expect(result.cookies).toEqual([]);
  });
});

describe('CabuMethods.askUtterance', () => {
  it('posts the utterance request with the replayed cookie header and returns the refreshed cookies', async () => {
    const cabuMethods = makeMethods();
    const post = vi.fn().mockResolvedValue({
      data: { utteranceId: 'utt-1', b3TraceId: 'trace-2' },
      headers: { 'set-cookie': ['cabuCtx=def456; Path=/; HttpOnly'] },
    });
    // @ts-expect-error - Replacing the Axios client for transport configuration coverage.
    cabuMethods._apiClient.axios.post = post;

    const result = await cabuMethods.askUtterance(
      'conv-1',
      {
        utterance: { content: 'How many orders in the West region?' },
        localization: { locale: 'en_US', language: 'en' },
        datasources: [{ datasourceLuid: 'ds-1' }],
      },
      ['cabuCtx=abc123; Path=/; HttpOnly'],
    );

    expect(result).toEqual({
      response: { utteranceId: 'utt-1', b3TraceId: 'trace-2' },
      cookies: ['cabuCtx=def456; Path=/; HttpOnly'],
    });
    expect(post).toHaveBeenCalledWith(
      '/conversations/conv-1/utterances',
      {
        utterance: { content: 'How many orders in the West region?' },
        localization: { locale: 'en_US', language: 'en' },
        datasources: [{ datasourceLuid: 'ds-1' }],
      },
      { headers: { Authorization: 'Bearer token', Cookie: 'cabuCtx=abc123' } },
    );
  });

  it('omits the Cookie header when there are no prior cookies to replay', async () => {
    const cabuMethods = makeMethods();
    const post = vi.fn().mockResolvedValue({
      data: { utteranceId: 'utt-1', b3TraceId: 'trace-2' },
      headers: {},
    });
    // @ts-expect-error - Replacing the Axios client for transport configuration coverage.
    cabuMethods._apiClient.axios.post = post;

    await cabuMethods.askUtterance(
      'conv-1',
      {
        utterance: { content: 'Hi' },
        localization: { locale: 'en_US', language: 'en' },
        datasources: [],
      },
      [],
    );

    expect(post).toHaveBeenCalledWith(
      '/conversations/conv-1/utterances',
      {
        utterance: { content: 'Hi' },
        localization: { locale: 'en_US', language: 'en' },
        datasources: [],
      },
      { headers: { Authorization: 'Bearer token' } },
    );
  });
});

describe('CabuMethods.streamUtterance', () => {
  it('requests the stream with the replayed cookie plus the constant XSRF cookie/header, and drains it', async () => {
    const cabuMethods = makeMethods();
    const stream = fakeStream([
      'event: response_complete\ndata: {"node":"response","response":"42 orders"}\n\n',
      'event: complete\ndata: {}\n\n',
    ]);
    const get = vi.fn().mockResolvedValue({ data: stream });
    // @ts-expect-error - Replacing the Axios client for transport configuration coverage.
    cabuMethods._apiClient.axios.get = get;

    const result = await cabuMethods.streamUtterance('conv-1', 'utt-1', [
      'cabuCtx=abc123; Path=/; HttpOnly',
    ]);

    expect(result).toEqual({
      status: 'complete',
      responseComplete: { node: 'response', response: '42 orders' },
    });
    expect(get).toHaveBeenCalledWith('/conversations/conv-1/utterances/utt-1/stream', {
      headers: {
        Authorization: 'Bearer token',
        Cookie: 'cabuCtx=abc123; XSRF-TOKEN=tableau-mcp',
        'X-XSRF-TOKEN': 'tableau-mcp',
      },
      responseType: 'stream',
    });
  });

  it('sends only the constant XSRF cookie when there are no prior cookies to replay', async () => {
    const cabuMethods = makeMethods();
    const stream = fakeStream(['event: complete\ndata: {}\n\n']);
    const get = vi.fn().mockResolvedValue({ data: stream });
    // @ts-expect-error - Replacing the Axios client for transport configuration coverage.
    cabuMethods._apiClient.axios.get = get;

    await cabuMethods.streamUtterance('conv-1', 'utt-1', []);

    expect(get).toHaveBeenCalledWith('/conversations/conv-1/utterances/utt-1/stream', {
      headers: {
        Authorization: 'Bearer token',
        Cookie: 'XSRF-TOKEN=tableau-mcp',
        'X-XSRF-TOKEN': 'tableau-mcp',
      },
      responseType: 'stream',
    });
  });
});
