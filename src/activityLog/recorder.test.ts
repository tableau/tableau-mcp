import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Config } from '../config.js';
import { stubDefaultEnvVars } from '../testShared.js';

vi.mock('../logging/logger.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../logging/logger.js')>();
  return { ...actual, log: vi.fn() };
});

import { log } from '../logging/logger.js';
import {
  ACTIVITY_LOG_LOGGER,
  createActivityLogRecorder,
  LoggingActivityLogRecorder,
} from './recorder.js';
import { CeppEventRecord, ICeppEvent } from './sdk/index.js';

const mockedLog = vi.mocked(log);

function makeSiteEvent(overrides: Partial<Record<string, unknown>> = {}): ICeppEvent {
  return {
    getEventMetadata: () => ({
      sdkName: 'test',
      sdkVersion: '0.0.0',
      eventType: 'TEST',
      eventVersion: '0.1',
      eventCategory: 'test',
      applicableToOnline: true,
      applicableToServer: true,
      customerAccessible: false,
      internalAccessible: true,
      comment: '',
    }),
    getEventTime: () => '2024-06-16T18:03:47.203309Z',
    isSiteEvent: () => true,
    isTenantEvent: () => false,
    toJSON: () => ({ eventType: 'TEST', ...overrides }),
  };
}

function configWith(activityLogEnabled: boolean): Config {
  if (activityLogEnabled) {
    vi.stubEnv('ACTIVITY_LOG_ENABLED', 'true');
  }
  return new Config();
}

describe('LoggingActivityLogRecorder', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    stubDefaultEnvVars();
    mockedLog.mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('records the event through the TMCP logger at debug level with the event JSON', () => {
    const recorder = createActivityLogRecorder(configWith(true));
    const event = makeSiteEvent({ toolName: 'list-projects' });

    recorder.record(event);

    expect(mockedLog).toHaveBeenCalledTimes(1);
    expect(mockedLog).toHaveBeenCalledWith({
      message: 'ActivityLog event recorded',
      level: 'debug',
      logger: ACTIVITY_LOG_LOGGER,
      data: expect.objectContaining({
        traceUuid: expect.any(String),
        event: expect.objectContaining({ toolName: 'list-projects' }),
      }),
    });
  });

  it('does not record when ACTIVITY_LOG_ENABLED is off (recordingEnabled=false)', () => {
    const recorder = createActivityLogRecorder(configWith(false));

    recorder.record(makeSiteEvent());

    expect(mockedLog).not.toHaveBeenCalled();
  });

  it('records each event of a batch', () => {
    const recorder = createActivityLogRecorder(configWith(true));

    recorder.recordBatch([makeSiteEvent(), makeSiteEvent()]);

    expect(mockedLog).toHaveBeenCalledTimes(2);
  });

  it('suppresses I/O errors from the sink instead of throwing', () => {
    class ThrowingRecorder extends LoggingActivityLogRecorder {
      protected emitRecord(_record: CeppEventRecord): void {
        throw new Error('network down');
      }
    }
    const recorder = new ThrowingRecorder(
      { recordingEnabled: true, tableauOnline: true, ioErrorSuppressionEnabled: true },
      {
        info: (message) => log({ message, level: 'debug', logger: ACTIVITY_LOG_LOGGER }),
        warn: (message) => log({ message, level: 'warning', logger: ACTIVITY_LOG_LOGGER }),
        error: (message) => log({ message, level: 'error', logger: ACTIVITY_LOG_LOGGER }),
      },
    );

    expect(() => recorder.record(makeSiteEvent())).not.toThrow();
    expect(mockedLog).toHaveBeenCalledWith(
      expect.objectContaining({ level: 'error', logger: ACTIVITY_LOG_LOGGER }),
    );
  });
});
