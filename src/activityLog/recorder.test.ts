import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Config } from '../config.js';
import { stubDefaultEnvVars } from '../testShared.js';
import { CeppEventLoggingRecorderOptions, ICeppEvent } from './sdkTypes.js';

vi.mock('../logging/logger.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../logging/logger.js')>();
  return { ...actual, log: vi.fn() };
});

// The CEPP SDK is an internal Nexus-only package, absent here. Mock its root export with a
// fake `CeppEventLoggingRecorder` that just captures the options it was constructed with,
// so we can assert TMCP wires config + loggers correctly. Recording behavior itself is the
// SDK's concern; the genuinely-absent-SDK path is covered in sdkAbsent.test.ts.
vi.mock('@tableau/activitylog-logging-client-ts', () => {
  class FakeCeppEventLoggingRecorder {
    options: CeppEventLoggingRecorderOptions;
    constructor(options: CeppEventLoggingRecorderOptions) {
      this.options = options;
    }
    record(_event: ICeppEvent): void {}
  }
  return { CeppEventLoggingRecorder: FakeCeppEventLoggingRecorder };
});

import { log } from '../logging/logger.js';
import { ACTIVITY_LOG_LOGGER, createActivityLogRecorder } from './recorder.js';

const mockedLog = vi.mocked(log);

function configWith(activityLogEnabled: boolean): Config {
  if (activityLogEnabled) {
    vi.stubEnv('ACTIVITY_LOG_ENABLED', 'true');
  }
  return new Config();
}

function optionsOf(recorder: unknown): CeppEventLoggingRecorderOptions {
  return (recorder as { options: CeppEventLoggingRecorderOptions }).options;
}

describe('createActivityLogRecorder', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    stubDefaultEnvVars();
    mockedLog.mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('builds the SDK recorder with recordingEnabled on and the TMCP loggers wired', async () => {
    const recorder = await createActivityLogRecorder(configWith(true));

    expect(recorder).not.toBeNull();
    const options = optionsOf(recorder);
    expect(options.config).toEqual({
      recordingEnabled: true,
      tableauOnline: true,
      ioErrorSuppressionEnabled: true,
    });
    // TMCP routes all three sinks to the same logger bridge.
    expect(options.logger).toBeDefined();
    expect(options.siteLogger).toBe(options.logger);
    expect(options.tenantLogger).toBe(options.logger);
  });

  it('sets recordingEnabled=false when ACTIVITY_LOG_ENABLED is off', async () => {
    const recorder = await createActivityLogRecorder(configWith(false));

    expect(recorder).not.toBeNull();
    expect(optionsOf(recorder).config.recordingEnabled).toBe(false);
  });

  it('bridges the SDK logger to the TMCP logger: info→debug, warn→warning, error→error', async () => {
    const recorder = await createActivityLogRecorder(configWith(true));
    const { logger } = optionsOf(recorder);

    logger?.info('recorded');
    expect(mockedLog).toHaveBeenCalledWith({
      message: 'recorded',
      level: 'debug',
      logger: ACTIVITY_LOG_LOGGER,
    });

    logger?.warn('suppressed io');
    expect(mockedLog).toHaveBeenCalledWith({
      message: 'suppressed io',
      level: 'warning',
      logger: ACTIVITY_LOG_LOGGER,
    });

    logger?.error('boom');
    expect(mockedLog).toHaveBeenCalledWith({
      message: 'boom',
      level: 'error',
      logger: ACTIVITY_LOG_LOGGER,
    });
  });
});
