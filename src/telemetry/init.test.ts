import { MockInstance } from 'vitest';

import { stubDefaultEnvVars } from '../testShared.js';
import { initializeTelemetry } from './init.js';
const mocks = vi.hoisted(() => ({
  MockNoOpTelemetryProvider: vi.fn(),
}));

vi.mock('./noop.js', () => ({
  NoOpTelemetryProvider: mocks.MockNoOpTelemetryProvider,
}));

describe('initializeTelemetry', () => {
  let consoleErrorSpy: MockInstance;
  let consoleWarnSpy: MockInstance;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    stubDefaultEnvVars();

    // Suppress console output
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Default mock implementations
    mocks.MockNoOpTelemetryProvider.mockImplementation(() => ({
      initialize: vi.fn(),
      recordMetric: vi.fn(),
    }));
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    consoleWarnSpy.mockRestore();
  });

  // NoOp tests
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
    expect(consoleErrorSpy).toHaveBeenCalled();
    expect(consoleWarnSpy).toHaveBeenCalledWith('Falling back to NoOp telemetry provider');
  });
});
