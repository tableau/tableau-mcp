import { stubDefaultEnvVars } from '../testShared.js';
import { initializeTelemetry } from './init.js';
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
