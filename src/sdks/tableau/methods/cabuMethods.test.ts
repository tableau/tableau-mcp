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
  it('posts the conversation request and returns the parsed response', async () => {
    const cabuMethods = makeMethods();
    const post = vi.fn().mockResolvedValue({
      data: {
        conversationId: 'conv-1',
        scope: 'tenant-1',
        datasources: [{ datasourceLuid: 'ds-1', datasourceName: 'Superstore' }],
        b3TraceId: 'trace-1',
      },
      headers: {},
    });
    // @ts-expect-error - Replacing the Axios client for transport configuration coverage.
    cabuMethods._apiClient.axios.post = post;

    const result = await cabuMethods.startConversation({
      dashboardDatasources: [{ datasourceLuid: 'ds-1' }],
    });

    expect(result).toEqual({
      conversationId: 'conv-1',
      scope: 'tenant-1',
      datasources: [{ datasourceLuid: 'ds-1', datasourceName: 'Superstore' }],
      b3TraceId: 'trace-1',
    });
    expect(post).toHaveBeenCalledWith(
      '/conversations',
      { dashboardDatasources: [{ datasourceLuid: 'ds-1' }] },
      { headers: { Authorization: 'Bearer token' } },
    );
  });

  it('parses a response whose datasource entries carry explicit nulls for workbook-only fields (PDS-only conversation)', async () => {
    const cabuMethods = makeMethods();
    const post = vi.fn().mockResolvedValue({
      data: {
        conversationId: 'conv-1',
        scope: 'tenant-1',
        datasources: [
          {
            sdmName: 'Superstore',
            workbookDatasourceId: null,
            datasourceLuid: 'ds-1',
            datasourceName: null,
            vdsDatasourceLuid: null,
          },
        ],
        b3TraceId: 'trace-1',
      },
      headers: {},
    });
    // @ts-expect-error - Replacing the Axios client for transport configuration coverage.
    cabuMethods._apiClient.axios.post = post;

    const result = await cabuMethods.startConversation({
      dashboardDatasources: [{ datasourceLuid: 'ds-1' }],
    });

    expect(result.datasources).toEqual([
      {
        sdmName: 'Superstore',
        workbookDatasourceId: null,
        datasourceLuid: 'ds-1',
        datasourceName: null,
        vdsDatasourceLuid: null,
      },
    ]);
  });
});

describe('CabuMethods.askUtterance', () => {
  it('posts the utterance request and returns the parsed response, with no cookie handling', async () => {
    const cabuMethods = makeMethods();
    const post = vi.fn().mockResolvedValue({
      data: { utteranceId: 'utt-1', b3TraceId: 'trace-2' },
      headers: {},
    });
    // @ts-expect-error - Replacing the Axios client for transport configuration coverage.
    cabuMethods._apiClient.axios.post = post;

    const result = await cabuMethods.askUtterance('conv-1', {
      utterance: { content: 'How many orders in the West region?' },
      localization: { locale: 'en_US', language: 'en' },
      datasources: [{ datasourceLuid: 'ds-1' }],
    });

    expect(result).toEqual({ utteranceId: 'utt-1', b3TraceId: 'trace-2' });
    expect(post).toHaveBeenCalledWith(
      '/conversations/conv-1/utterances',
      {
        utterance: { content: 'How many orders in the West region?' },
        localization: { locale: 'en_US', language: 'en' },
        datasources: [{ datasourceLuid: 'ds-1' }],
      },
      { headers: { Authorization: 'Bearer token' } },
    );
  });
});

describe('CabuMethods.streamUtterance', () => {
  it('requests the stream with only the constant XSRF cookie/header, and drains it', async () => {
    const cabuMethods = makeMethods();
    const stream = fakeStream([
      'event: response_complete\ndata: {"node":"response","response":"42 orders"}\n\n',
      'event: complete\ndata: {}\n\n',
    ]);
    const get = vi.fn().mockResolvedValue({ data: stream });
    // @ts-expect-error - Replacing the Axios client for transport configuration coverage.
    cabuMethods._apiClient.axios.get = get;

    const result = await cabuMethods.streamUtterance('conv-1', 'utt-1');

    expect(result).toEqual({
      status: 'complete',
      responseComplete: { node: 'response', response: '42 orders' },
    });
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
