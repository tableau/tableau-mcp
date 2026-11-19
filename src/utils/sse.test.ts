import { SseParser } from './sse.js';

describe('SseParser', () => {
  it('parses a single event terminated by a blank line', () => {
    const parser = new SseParser();

    const events = parser.push('event: response_complete\ndata: {"ok":true}\n\n');

    expect(events).toEqual([{ event: 'response_complete', data: '{"ok":true}' }]);
  });

  it('joins multiple data: lines in one record with a newline', () => {
    const parser = new SseParser();

    const events = parser.push('event: response_complete\ndata: line one\ndata: line two\n\n');

    expect(events).toEqual([{ event: 'response_complete', data: 'line one\nline two' }]);
  });

  it('parses multiple events delivered in a single chunk', () => {
    const parser = new SseParser();

    const events = parser.push(
      'event: reasoning_complete\ndata: {}\n\nevent: action_complete\ndata: {}\n\n',
    );

    expect(events).toEqual([
      { event: 'reasoning_complete', data: '{}' },
      { event: 'action_complete', data: '{}' },
    ]);
  });

  it('buffers a record split across pushes and emits it once complete', () => {
    const parser = new SseParser();

    const firstPush = parser.push('event: response_comp');
    expect(firstPush).toEqual([]);

    const secondPush = parser.push('lete\ndata: {"ok":true}\n\n');
    expect(secondPush).toEqual([{ event: 'response_complete', data: '{"ok":true}' }]);
  });

  it('ignores comment lines starting with a colon', () => {
    const parser = new SseParser();

    const events = parser.push(': heartbeat\nevent: complete\ndata: {}\n\n');

    expect(events).toEqual([{ event: 'complete', data: '{}' }]);
  });

  it('defaults the event name to "message" when no event: line is present', () => {
    const parser = new SseParser();

    const events = parser.push('data: {"untyped":true}\n\n');

    expect(events).toEqual([{ event: 'message', data: '{"untyped":true}' }]);
  });

  it('parses the terminal error event', () => {
    const parser = new SseParser();

    const events = parser.push(
      'event: error\ndata: {"error_code":"BAD_REQUEST","error_details":"bad"}\n\n',
    );

    expect(events).toEqual([
      { event: 'error', data: '{"error_code":"BAD_REQUEST","error_details":"bad"}' },
    ]);
  });
});
