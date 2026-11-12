import { Readable } from 'stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { drainSseStream } from './cabuStream.js';

const TIMEOUT_MS = 1000;

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

    await expect(drainSseStream(stream, TIMEOUT_MS)).resolves.toEqual({
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

    await expect(drainSseStream(stream, TIMEOUT_MS)).resolves.toEqual({
      status: 'complete',
      responseComplete: { node: 'response', response: 'ok' },
    });
  });

  it('resolves error with the parsed error payload', async () => {
    const stream = fakeStream([
      'event: error\ndata: {"error_code":"WAII_TIMEOUT","error_details":"took too long"}\n\n',
    ]);

    await expect(drainSseStream(stream, TIMEOUT_MS)).resolves.toEqual({
      status: 'error',
      error: { error_code: 'WAII_TIMEOUT', error_details: 'took too long' },
    });
  });

  it('resolves incomplete when the stream ends without a terminal event', async () => {
    const stream = fakeStream([
      'event: response_complete\ndata: {"node":"response","response":"partial"}\n\n',
    ]);

    await expect(drainSseStream(stream, TIMEOUT_MS)).resolves.toEqual({
      status: 'incomplete',
      responseComplete: { node: 'response', response: 'partial' },
    });
  });

  it('rejects when the underlying stream errors', async () => {
    const stream = new Readable({ read() {} });
    const promise = drainSseStream(stream, TIMEOUT_MS);
    stream.emit('error', new Error('socket hang up'));

    await expect(promise).rejects.toThrow('socket hang up');
  });

  it('clears the drain timer when the underlying stream errors', async () => {
    vi.useFakeTimers();
    try {
      const stream = new Readable({ read() {} });
      const promise = drainSseStream(stream, TIMEOUT_MS);
      stream.emit('error', new Error('socket hang up'));

      await expect(promise).rejects.toThrow('socket hang up');
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('splits one record across two chunks and still parses it', async () => {
    const stream = fakeStream([
      'event: response_comp',
      'lete\ndata: {"node":"response","response":"chunked"}\n\n',
      'event: complete\ndata: {}\n\n',
    ]);

    await expect(drainSseStream(stream, TIMEOUT_MS)).resolves.toEqual({
      status: 'complete',
      responseComplete: { node: 'response', response: 'chunked' },
    });
  });

  describe('when the body stalls', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('resolves incomplete and destroys the stream once timeoutMs elapses with no terminal event', async () => {
      const stream = new Readable({ read() {} });
      const destroySpy = vi.spyOn(stream, 'destroy');
      stream.push(
        Buffer.from('event: response_complete\ndata: {"node":"response","response":"stalled"}\n\n'),
      );

      const promise = drainSseStream(stream, TIMEOUT_MS);
      await vi.advanceTimersByTimeAsync(TIMEOUT_MS);

      await expect(promise).resolves.toEqual({
        status: 'incomplete',
        responseComplete: { node: 'response', response: 'stalled' },
      });
      expect(destroySpy).toHaveBeenCalled();
    });

    it('does not time out once a terminal event has already resolved the stream', async () => {
      const stream = fakeStream(['event: complete\ndata: {}\n\n']);

      const promise = drainSseStream(stream, TIMEOUT_MS);
      await expect(promise).resolves.toEqual({ status: 'complete', responseComplete: undefined });

      // The pending timer is cleared on resolution; advancing past it must not throw or hang.
      await vi.advanceTimersByTimeAsync(TIMEOUT_MS);
    });
  });
});
