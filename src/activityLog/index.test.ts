import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Config } from '../config.js';
import { stubDefaultEnvVars } from '../testShared.js';
import { CeppEventLoggingRecorderOptions, ICeppEvent } from './sdkTypes.js';

vi.mock('../logging/logger.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../logging/logger.js')>();
  return { ...actual, log: vi.fn() };
});

// Lets a test override the SDK recorder's `record` behavior (e.g. throw) without
// re-mocking. Hoisted so the vi.mock factories below can close over it.
const hoisted = vi.hoisted(() => ({
  recordImpl: undefined as
    | undefined
    | ((event: ICeppEvent, options: CeppEventLoggingRecorderOptions) => void),
}));

// Mock the SDK root: a fake recorder whose default `record` mimics the real SDK — serialize
// the event and route site events to `siteLogger.info` (which TMCP bridges to log()/debug).
vi.mock('@tableau/activitylog-logging-client-ts', () => {
  class FakeCeppEventLoggingRecorder {
    options: CeppEventLoggingRecorderOptions;
    constructor(options: CeppEventLoggingRecorderOptions) {
      this.options = options;
    }
    record(event: ICeppEvent): void {
      if (hoisted.recordImpl) {
        hoisted.recordImpl(event, this.options);
        return;
      }
      if (event.isSiteEvent()) {
        this.options.siteLogger?.info(JSON.stringify(event.toJSON()));
      }
    }
  }
  return { CeppEventLoggingRecorder: FakeCeppEventLoggingRecorder };
});

// Mock the SDK `./events` subpath: a builder that echoes its values into the built event.
vi.mock('@tableau/activitylog-logging-client-ts/events', () => {
  class FakeBuilder {
    values: Record<string, string> = {};
    setEventTime(v: string): this {
      this.values.eventTime = v;
      return this;
    }
    setServiceName(v: string): this {
      this.values.serviceName = v;
      return this;
    }
    setSiteLuid(v: string): this {
      this.values.siteLuid = v;
      return this;
    }
    setActorUserLuid(v: string): this {
      this.values.actorUserLuid = v;
      return this;
    }
    setInitiatingUserLuid(v: string): this {
      this.values.initiatingUserLuid = v;
      return this;
    }
    setPlatform(v: string): this {
      this.values.platform = v;
      return this;
    }
    setPlatformVersion(v: string): this {
      this.values.platformVersion = v;
      return this;
    }
    setOperationType(v: string): this {
      this.values.operationType = v;
      return this;
    }
    build(): ICeppEvent {
      const values = this.values;
      return {
        getEventTime: () => values.eventTime,
        isSiteEvent: () => true,
        isTenantEvent: () => false,
        toJSON: () => ({ ...values }),
      };
    }
  }
  return {
    ActivityLogSettingsChange: {
      builder: (): FakeBuilder => new FakeBuilder(),
    },
  };
});

import { log } from '../logging/logger.js';
import { ACTIVITY_LOG_LOGGER, recordActivityLogEvent } from './index.js';

const mockedLog = vi.mocked(log);

describe('recordActivityLogEvent', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    stubDefaultEnvVars();
    mockedLog.mockClear();
    hoisted.recordImpl = undefined;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('builds and records the POC event when ACTIVITY_LOG_ENABLED is on', async () => {
    vi.stubEnv('ACTIVITY_LOG_ENABLED', 'true');

    await recordActivityLogEvent(new Config());

    // The SDK recorder serialized the built event and routed it to the TMCP logger at debug.
    expect(mockedLog).toHaveBeenCalledTimes(1);
    const call = mockedLog.mock.calls[0][0];
    expect(call.level).toBe('debug');
    expect(call.logger).toBe(ACTIVITY_LOG_LOGGER);
    expect(call.message).toContain('tableau-mcp');
    expect(call.message).toContain('Tableau Cloud');
    expect(call.message).toContain('"operationType":"create"');
  });

  it('is a no-op when ACTIVITY_LOG_ENABLED is off', async () => {
    await recordActivityLogEvent(new Config());

    expect(mockedLog).not.toHaveBeenCalled();
  });

  it('never throws (and swallows) when the recorder sink fails, even with the flag on', async () => {
    vi.stubEnv('ACTIVITY_LOG_ENABLED', 'true');
    hoisted.recordImpl = () => {
      throw new Error('sink down');
    };

    await expect(recordActivityLogEvent(new Config())).resolves.toBeUndefined();
  });
});
