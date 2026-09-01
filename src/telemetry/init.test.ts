import { stubDefaultEnvVars } from '../testShared.js';
import { initializeTelemetry, validateTelemetryProvider } from './init.js';
const mocks = vi.hoisted(() => ({
  MockNoOpTelemetryProvider: vi.fn(),
}));

vi.mock('./noop.js', () => ({
  NoOpTelemetryProvider: mocks.MockNoOpTelemetryProvider,
}));

describe('initializeTelemetry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    stubDefaultEnvVars();

    // Default mock implementations
    mocks.MockNoOpTelemetryProvider.mockImplementation(() => ({
      initialize: vi.fn(),
      recordMetric: vi.fn(),
      recordHistogram: vi.fn(),
    }));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns NoOpTelemetryProvider when provider is "noop"', () => {
    vi.stubEnv('TELEMETRY_PROVIDER', 'noop');

    initializeTelemetry();

    expect(mocks.MockNoOpTelemetryProvider).toHaveBeenCalled();
  });

  it('returns NoOpTelemetryProvider when provider is "custom" and module path is invalid', () => {
    vi.stubEnv('TELEMETRY_PROVIDER', 'custom');
    vi.stubEnv('TELEMETRY_PROVIDER_CONFIG', '{"module":"./invalid-module.js"}');

    initializeTelemetry();

    expect(mocks.MockNoOpTelemetryProvider).toHaveBeenCalled();
  });
});

describe('validateTelemetryProvider', () => {
  it('accepts a provider missing startSpan (backward compatibility)', () => {
    const provider = {
      initialize: () => {},
      recordMetric: () => {},
      recordHistogram: () => {},
    };

    expect(() => validateTelemetryProvider(provider)).not.toThrow();
  });

  it('accepts a provider that also implements startSpan', () => {
    const provider = {
      initialize: () => {},
      recordMetric: () => {},
      recordHistogram: () => {},
      startSpan: () => ({ end: () => {} }),
    };

    expect(() => validateTelemetryProvider(provider)).not.toThrow();
  });

  it('throws when a required method is missing', () => {
    const provider = {
      initialize: () => {},
      recordHistogram: () => {},
    };

    expect(() => validateTelemetryProvider(provider)).toThrowError(
      'Custom provider missing required methods: recordMetric',
    );
  });

  it('throws when the provider is not an object', () => {
    expect(() => validateTelemetryProvider('not-an-object')).toThrowError('Provider must be an object');
  });
});
