import { beforeEach, describe, expect, it, Mock, vi } from 'vitest';

// Mock the config module
vi.mock('../config.js', () => ({
  getConfig: vi.fn(),
}));

// Mock the provider modules
vi.mock('./moncloud.js', () => ({
  MonCloudTelemetryProvider: vi.fn().mockImplementation(() => ({
    initialize: vi.fn(),
    addAttributes: vi.fn(),
  })),
}));

vi.mock('./noop.js', () => ({
  NoOpTelemetryProvider: vi.fn().mockImplementation(() => ({
    initialize: vi.fn(),
    addAttributes: vi.fn(),
  })),
}));

import { getConfig } from '../config.js';
import { initializeTelemetry } from './init.js';
import { MonCloudTelemetryProvider } from './moncloud.js';
import { NoOpTelemetryProvider } from './noop.js';
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
  it('returns MonCloudTelemetryProvider when provider is "moncloud"', () => {
    mockGetConfig.mockReturnValue({
      telemetry: { ...defaultTelemetryConfig, provider: 'moncloud' },
    });

    initializeTelemetry();

    expect(MonCloudTelemetryProvider).toHaveBeenCalled();
  });

  // NoOp tests
  it('returns NoOpTelemetryProvider when telemetry is disabled', () => {
    mockGetConfig.mockReturnValue({
      telemetry: { ...defaultTelemetryConfig, enabled: false },
    });

    const provider = initializeTelemetry();

    expect(NoOpTelemetryProvider).toHaveBeenCalled();
    expect(provider.initialize).toBeDefined();
    expect(provider.addAttributes).toBeDefined();
  });

  it('returns NoOpTelemetryProvider when provider is "noop"', () => {
    mockGetConfig.mockReturnValue({
      telemetry: { ...defaultTelemetryConfig, provider: 'noop' },
    });

    initializeTelemetry();

    expect(NoOpTelemetryProvider).toHaveBeenCalled();
  });

  it('returns NoOpTelemetryProvider for unknown provider with warning', () => {
    mockGetConfig.mockReturnValue({
      telemetry: { ...defaultTelemetryConfig, provider: 'unknown-provider' },
    });

    initializeTelemetry();

    expect(NoOpTelemetryProvider).toHaveBeenCalled();
  });

  it('falls back to NoOpTelemetryProvider on initialization error', () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Make MonCloudTelemetryProvider throw during initialization
    (MonCloudTelemetryProvider as Mock).mockImplementationOnce(() => ({
      initialize: vi.fn().mockImplementation(() => {
        throw new Error('Init failed');
      }),
      addAttributes: vi.fn(),
    }));

    mockGetConfig.mockReturnValue({
      telemetry: { ...defaultTelemetryConfig, provider: 'moncloud' },
    });

    const provider = initializeTelemetry();

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Failed to initialize telemetry provider:',
      expect.any(Error),
    );
    expect(consoleWarnSpy).toHaveBeenCalledWith('Falling back to NoOp telemetry provider');
    expect(provider).toBeDefined();

    consoleErrorSpy.mockRestore();
    consoleWarnSpy.mockRestore();
  });
});
