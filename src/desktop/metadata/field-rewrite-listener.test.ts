import {
  emitFieldRewrite,
  type FieldRewriteEvent,
  setFieldRewriteListener,
} from './field-rewrite-listener.js';

describe('field-rewrite-listener', () => {
  afterEach(() => {
    // Always reset to prevent test pollution
    setFieldRewriteListener(null);
  });

  it('should call the registered listener when an event is emitted', () => {
    const events: FieldRewriteEvent[] = [];
    setFieldRewriteListener((e) => events.push(e));

    const event: FieldRewriteEvent = {
      requested: '[sum:Profit:qk]',
      applied: '[usr:Profit:qk]',
      reason: 'already aggregated',
    };
    emitFieldRewrite(event);

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual(event);
  });

  it('should not throw when no listener is registered', () => {
    expect(() => emitFieldRewrite({ requested: 'a', applied: 'b', reason: 'test' })).not.toThrow();
  });

  it('should stop calling a listener after it is cleared with null', () => {
    const events: FieldRewriteEvent[] = [];
    setFieldRewriteListener((e) => events.push(e));
    setFieldRewriteListener(null);

    emitFieldRewrite({ requested: 'a', applied: 'b', reason: 'test' });

    expect(events).toHaveLength(0);
  });

  it('should replace a previous listener when a new one is set', () => {
    const first: FieldRewriteEvent[] = [];
    const second: FieldRewriteEvent[] = [];

    setFieldRewriteListener((e) => first.push(e));
    setFieldRewriteListener((e) => second.push(e));

    emitFieldRewrite({ requested: 'a', applied: 'b', reason: 'test' });

    expect(first).toHaveLength(0);
    expect(second).toHaveLength(1);
  });

  it('should swallow errors thrown by the listener', () => {
    setFieldRewriteListener(() => {
      throw new Error('listener error');
    });

    expect(() => emitFieldRewrite({ requested: 'a', applied: 'b', reason: 'test' })).not.toThrow();
  });

  it('should pass all event properties to the listener', () => {
    let received: FieldRewriteEvent | null = null;
    setFieldRewriteListener((e) => (received = e));

    const event: FieldRewriteEvent = {
      requested: '[sum:Profit:qk]',
      applied: '[usr:Profit:qk]',
      reason: 'double aggregation',
      fabricated: true,
      datasource: 'Sample',
    };
    emitFieldRewrite(event);

    expect(received).toEqual(event);
  });
});
