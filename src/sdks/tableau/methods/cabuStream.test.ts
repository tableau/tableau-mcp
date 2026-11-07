import { Readable } from 'stream';
import { describe, expect, it } from 'vitest';

import { drainSseStream } from './cabuStream.js';

function fakeStream(chunks: Array<string>): Readable {
  const stream = new Readable({ read() {} });
  for (const chunk of chunks) {
    stream.push(Buffer.from(chunk));
  }
  stream.push(null);
  return stream;
}

describe('drainSseStream', () => {
  it('resolves complete with the parsed response_complete payload once `complete` arrives', async () => {
    const stream = fakeStream([
      'event: response_complete\ndata: {"node":"response","response":"42 orders"}\n\n',
      'event: complete\ndata: {}\n\n',
    ]);

    await expect(drainSseStream(stream)).resolves.toEqual({
      status: 'complete',
      responseComplete: { node: 'response', response: '42 orders' },
    });
  });

  it('drains intermediate progress events without parsing them', async () => {
    const stream = fakeStream([
      'event: traceId\ndata: {"traceId":"abc"}\n\n',
      'event: classification_complete\ndata: {}\n\n',
      'event: reasoning_complete\ndata: {}\n\n',
      'event: action_complete\ndata: {}\n\n',
      'event: response_complete\ndata: {"node":"response","response":"ok"}\n\n',
      'event: complete\ndata: {}\n\n',
    ]);

    await expect(drainSseStream(stream)).resolves.toEqual({
      status: 'complete',
      responseComplete: { node: 'response', response: 'ok' },
    });
  });

  it('resolves error with the parsed error payload', async () => {
    const stream = fakeStream([
      'event: error\ndata: {"error_code":"WAII_TIMEOUT","error_details":"took too long"}\n\n',
    ]);

    await expect(drainSseStream(stream)).resolves.toEqual({
      status: 'error',
      error: { error_code: 'WAII_TIMEOUT', error_details: 'took too long' },
    });
  });

  it('resolves incomplete when the stream ends without a terminal event', async () => {
    const stream = fakeStream([
      'event: response_complete\ndata: {"node":"response","response":"partial"}\n\n',
    ]);

    await expect(drainSseStream(stream)).resolves.toEqual({
      status: 'incomplete',
      responseComplete: { node: 'response', response: 'partial' },
    });
  });

  it('rejects when the underlying stream errors', async () => {
    const stream = new Readable({ read() {} });
    const promise = drainSseStream(stream);
    stream.emit('error', new Error('socket hang up'));

    await expect(promise).rejects.toThrow('socket hang up');
  });

  it('splits one record across two chunks and still parses it', async () => {
    const stream = fakeStream([
      'event: response_comp',
      'lete\ndata: {"node":"response","response":"chunked"}\n\n',
      'event: complete\ndata: {}\n\n',
    ]);

    await expect(drainSseStream(stream)).resolves.toEqual({
      status: 'complete',
      responseComplete: { node: 'response', response: 'chunked' },
    });
  });
});
