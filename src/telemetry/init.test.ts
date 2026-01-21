import { MockInstance } from 'vitest';

import { initializeTelemetry } from './init.js';
import { TelemetryConfig } from './types.js';

const mocks = vi.hoisted(() => ({
  mockGetConfig: vi.fn(),
  MockMonCloudTelemetryProvider: vi.fn(),
  MockNoOpTelemetryProvider: vi.fn(),
}));

vi.mock('../config.js', () => ({
  getConfig: mocks.mockGetConfig,
}));

vi.mock('./moncloud.js', () => ({
  MonCloudTelemetryProvider: mocks.MockMonCloudTelemetryProvider,
}));

vi.mock('./noop.js', () => ({
  NoOpTelemetryProvider: mocks.MockNoOpTelemetryProvider,
}));

describe('initializeTelemetry', () => {
  const defaultTelemetryConfig: TelemetryConfig = {
    provider: 'noop',
  };

  let consoleErrorSpy: MockInstance;
  let consoleWarnSpy: MockInstance;

  beforeEach(() => {
    vi.clearAllMocks();

    // Suppress console output
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Default mock implementations
    mocks.MockMonCloudTelemetryProvider.mockImplementation(() => ({
      initialize: vi.fn(),
      recordMetric: vi.fn(),
    }));

    mocks.MockNoOpTelemetryProvider.mockImplementation(() => ({
      initialize: vi.fn(),
      recordMetric: vi.fn(),
    }));
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    consoleWarnSpy.mockRestore();
  });

  // MonCloud tests
  it('returns MonCloudTelemetryProvider when provider is "moncloud"', () => {
    mocks.mockGetConfig.mockReturnValue({
      telemetry: { ...defaultTelemetryConfig, provider: 'moncloud' },
    });

    initializeTelemetry();

    expect(mocks.MockMonCloudTelemetryProvider).toHaveBeenCalled();
  });

  // NoOp tests
  it('returns NoOpTelemetryProvider when provider is "noop"', () => {
    mocks.mockGetConfig.mockReturnValue({
      telemetry: { ...defaultTelemetryConfig, provider: 'noop' },
    });

    initializeTelemetry();

    expect(mocks.MockNoOpTelemetryProvider).toHaveBeenCalled();
  });

  it('returns NoOpTelemetryProvider for unknown provider with warning', () => {
    mocks.mockGetConfig.mockReturnValue({
      telemetry: { ...defaultTelemetryConfig, provider: 'unknown-provider' },
    });

    initializeTelemetry();

    expect(mocks.MockNoOpTelemetryProvider).toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalled();
    expect(consoleWarnSpy).toHaveBeenCalledWith('Falling back to NoOp telemetry provider');
  });

  it('falls back to NoOpTelemetryProvider on initialization error', () => {
    // Make MonCloudTelemetryProvider throw during initialization
    mocks.MockMonCloudTelemetryProvider.mockImplementationOnce(() => ({
      initialize: vi.fn().mockImplementation(() => {
        throw new Error('Init failed');
      }),
      recordMetric: vi.fn(),
    }));

    mocks.mockGetConfig.mockReturnValue({
      telemetry: { ...defaultTelemetryConfig, provider: 'moncloud' },
    });

    const provider = initializeTelemetry();

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Failed to initialize telemetry provider:',
      expect.any(Error),
    );
    expect(consoleWarnSpy).toHaveBeenCalledWith('Falling back to NoOp telemetry provider');
    expect(provider).toBeDefined();
  });
});
