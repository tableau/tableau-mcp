import { beforeEach, describe, expect, it, vi, Mock } from 'vitest';

// Mock the config module
vi.mock('../config.js', () => ({
  getConfig: vi.fn(),
}));

// Mock the provider modules
vi.mock('./moncloud.js', () => ({
  MonCloudTelemetryProvider: vi.fn().mockImplementation(() => ({
    initialize: vi.fn().mockResolvedValue(undefined),
    addAttributes: vi.fn(),
  })),
}));

vi.mock('./noop.js', () => ({
  NoOpTelemetryProvider: vi.fn().mockImplementation(() => ({
    initialize: vi.fn().mockResolvedValue(undefined),
    addAttributes: vi.fn(),
  })),
}));

import { getConfig } from '../config.js';
import { MonCloudTelemetryProvider } from './moncloud.js';
import { NoOpTelemetryProvider } from './noop.js';
import { initializeTelemetry } from './init.js';
import { TelemetryConfig } from './types.js';

describe('initializeTelemetry', () => {
  const mockGetConfig = getConfig as Mock;

  const defaultTelemetryConfig: TelemetryConfig = {
    enabled: true,
    provider: 'noop',
    serviceName: 'test-service',
    serviceVersion: '1.0.0',
    environment: 'test',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });


  // MonCloud tests
  it('returns MonCloudTelemetryProvider when provider is "moncloud"', async () => {
    mockGetConfig.mockReturnValue({
      telemetry: { ...defaultTelemetryConfig, provider: 'moncloud' },
    });

    await initializeTelemetry();

    expect(MonCloudTelemetryProvider).toHaveBeenCalled();
  });

  // Custom provider tests
  it('loads custom provider from module path', async () => {
    const mockInitialize = vi.fn().mockResolvedValue(undefined);
    const mockAddAttributes = vi.fn();

    // Define the mock constructor outside so we can reference it
    const MockCustomProvider = vi.fn().mockImplementation(() => ({
      initialize: mockInitialize,
      addAttributes: mockAddAttributes,
    }));

    // Mock the dynamic import
    vi.doMock('my-custom-telemetry', () => ({
      default: MockCustomProvider,
    }));

    mockGetConfig.mockReturnValue({
      telemetry: {
        ...defaultTelemetryConfig,
        provider: 'custom',
        providerConfig: { module: 'my-custom-telemetry' },
      },
    });

    await initializeTelemetry();

    expect(MockCustomProvider).toHaveBeenCalled();
    expect(mockInitialize).toHaveBeenCalled();

    vi.resetModules();
  });

  // NoOp tests
  it('returns NoOpTelemetryProvider when telemetry is disabled', async () => {
    mockGetConfig.mockReturnValue({
      telemetry: { ...defaultTelemetryConfig, enabled: false },
    });

    const provider = await initializeTelemetry();

    expect(NoOpTelemetryProvider).toHaveBeenCalled();
    expect(provider.initialize).toBeDefined();
    expect(provider.addAttributes).toBeDefined();
  });

  it('returns NoOpTelemetryProvider when provider is "noop"', async () => {
    mockGetConfig.mockReturnValue({
      telemetry: { ...defaultTelemetryConfig, provider: 'noop' },
    });

    await initializeTelemetry();

    expect(NoOpTelemetryProvider).toHaveBeenCalled();
  });

  it('returns NoOpTelemetryProvider for unknown provider with warning', async () => {
    mockGetConfig.mockReturnValue({
      telemetry: { ...defaultTelemetryConfig, provider: 'unknown-provider' },
    });

    await initializeTelemetry();

    expect(NoOpTelemetryProvider).toHaveBeenCalled();
  });

  it('falls back to NoOpTelemetryProvider on initialization error', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Make MonCloudTelemetryProvider throw during initialization
    (MonCloudTelemetryProvider as Mock).mockImplementationOnce(() => ({
      initialize: vi.fn().mockRejectedValue(new Error('Init failed')),
      addAttributes: vi.fn(),
    }));

    mockGetConfig.mockReturnValue({
      telemetry: { ...defaultTelemetryConfig, provider: 'moncloud' },
    });

    const provider = await initializeTelemetry();

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Failed to initialize telemetry provider:',
      expect.any(Error)
    );
    expect(consoleWarnSpy).toHaveBeenCalledWith('Falling back to NoOp telemetry provider');
    expect(provider).toBeDefined();

    consoleErrorSpy.mockRestore();
    consoleWarnSpy.mockRestore();
  });
});
