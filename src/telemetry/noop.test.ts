import { NoOpTelemetryProvider } from './noop.js';

describe('NoOpTelemetryProvider', () => {
  it('initialize is a no-op', () => {
    const provider = new NoOpTelemetryProvider();
    expect(() => provider.initialize()).not.toThrow();
  });

  it('recordMetric is a no-op', () => {
    const provider = new NoOpTelemetryProvider();
    expect(() => provider.recordMetric('metric', 1, {})).not.toThrow();
  });

  it('recordHistogram is a no-op', () => {
    const provider = new NoOpTelemetryProvider();
    expect(() => provider.recordHistogram('metric', 1, {})).not.toThrow();
  });

  it('startSpan returns a handle whose end() is a no-op', () => {
    const provider = new NoOpTelemetryProvider();
    const span = provider.startSpan();
    expect(() => span.end()).not.toThrow();
    expect(() => span.end(new Error('boom'))).not.toThrow();
  });
});
