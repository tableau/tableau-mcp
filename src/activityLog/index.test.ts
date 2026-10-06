import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Config } from '../config.js';
import { stubDefaultEnvVars } from '../testShared.js';
import { McpToolCallDetails } from './mcpToolCall.js';
import { CeppEventLoggingRecorderOptions, ICeppEvent, McpToolCallBuilder } from './sdkTypes.js';
import { SITE_EVENT_FILE_NAME } from './siteEventFileSink.js';

vi.mock('../logging/logger.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../logging/logger.js')>();
  return { ...actual, log: vi.fn() };
});

const hoisted = vi.hoisted(() => ({
  recorderCount: 0,
  recordImpl: undefined as undefined | ((event: ICeppEvent) => void),
  // Stands in for an SDK older than 9.87.0, which has no McpToolCall event.
  noMcpToolCall: false,
}));

// The CEPP SDK is not installed here, so stand in for it. Like the real recorder, the fake one
// does nothing when recording is disabled and otherwise writes
// `{"traceUuid":..., "event": {...}}` to the site logger.
vi.mock('@tableau/activitylog-logging-client-ts', () => {
  class FakeCeppEventLoggingRecorder {
    constructor(readonly options: CeppEventLoggingRecorderOptions) {
      hoisted.recorderCount++;
    }
    record(event: ICeppEvent): void {
      if (hoisted.recordImpl) {
        hoisted.recordImpl(event);
        return;
      }
      if (!this.options.config.recordingEnabled) {
        return;
      }
      this.options.siteLogger?.info(JSON.stringify({ traceUuid: 'trace', event: event.toJSON() }));
    }
  }
  return { CeppEventLoggingRecorder: FakeCeppEventLoggingRecorder };
});

// Every `setX(value)` on the fake builder stores `x: value`.
vi.mock('@tableau/activitylog-logging-client-ts/events', () => ({
  get McpToolCall() {
    return hoisted.noMcpToolCall ? undefined : fakeMcpToolCall;
  },
}));

const fakeMcpToolCall = vi.hoisted(() => ({
  builder: () => {
    const values: Record<string, string> = {};
    const builder: McpToolCallBuilder = new Proxy({} as McpToolCallBuilder, {
      get: (_target, prop: string) =>
        prop === 'build'
          ? () => ({
              getEventTime: () => values.eventTime,
              isSiteEvent: () => true,
              isTenantEvent: () => false,
              toJSON: () => ({ ...values }),
            })
          : (value: string) => {
              values[prop.charAt(3).toLowerCase() + prop.slice(4)] = value;
              return builder;
            },
    });
    return builder;
  },
}));

import { log } from '../logging/logger.js';
import { recordMcpToolCall, resetActivityLog } from './index.js';
import { ACTIVITY_LOG_LOGGER } from './recorder.js';

const mockedLog = vi.mocked(log);

const details: McpToolCallDetails = {
  toolName: 'list-workbooks',
  siteLuid: '11111111-2222-3333-4444-555555555555',
  userLuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  success: true,
  errorCode: '',
  oauthClientId: undefined,
  userAgent: 'test-agent/1.0',
  mcpRequestId: '7',
  object: undefined,
};

function activityLogLines(level?: string): string[] {
  return mockedLog.mock.calls
    .map(([entry]) => entry)
    .filter((entry) => entry.logger === ACTIVITY_LOG_LOGGER && (!level || entry.level === level))
    .map((entry) => entry.message);
}

describe('recordMcpToolCall', () => {
  let directory: string;

  beforeEach(() => {
    vi.unstubAllEnvs();
    stubDefaultEnvVars();
    mockedLog.mockClear();
    resetActivityLog();
    hoisted.recorderCount = 0;
    hoisted.recordImpl = undefined;
    hoisted.noMcpToolCall = false;
    directory = mkdtempSync(join(tmpdir(), 'activity-log-'));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(directory, { recursive: true, force: true });
  });

  it('does nothing, without setting up the SDK, when ACTIVITY_LOG_ENABLED is off', async () => {
    vi.stubEnv('ACTIVITY_LOG_DIRECTORY', directory);

    await recordMcpToolCall(new Config(), details);

    expect(hoisted.recorderCount).toBe(0);
    expect(mockedLog).not.toHaveBeenCalled();
  });

  it('writes the event as a line of the site event file when ACTIVITY_LOG_DIRECTORY is set', async () => {
    vi.stubEnv('ACTIVITY_LOG_ENABLED', 'true');
    vi.stubEnv('ACTIVITY_LOG_DIRECTORY', directory);

    await recordMcpToolCall(new Config(), details);
    await recordMcpToolCall(new Config(), { ...details, toolName: 'query-datasource' });

    const lines = readFileSync(join(directory, SITE_EVENT_FILE_NAME), 'utf8').trim().split('\n');
    expect(lines.map((line) => JSON.parse(line).event.toolName)).toEqual([
      'list-workbooks',
      'query-datasource',
    ]);
    expect(JSON.parse(lines[0]).event).toMatchObject({
      serviceName: 'tableau-mcp',
      siteLuid: details.siteLuid,
      actorUserLuid: details.userLuid,
      eventOutcome: 'success',
      userAgent: 'test-agent/1.0',
      mcpRequestId: '7',
    });
    // Nothing goes to the regular logger when the file sink is in use.
    expect(activityLogLines()).toEqual([]);
  });

  it('sends the event to the logger at debug level when ACTIVITY_LOG_DIRECTORY is not set', async () => {
    vi.stubEnv('ACTIVITY_LOG_ENABLED', 'true');

    await recordMcpToolCall(new Config(), details);

    const [line] = activityLogLines('debug');
    expect(JSON.parse(line).event.toolName).toBe('list-workbooks');
  });

  it('warns once that events are not shipped when ACTIVITY_LOG_DIRECTORY is not set', async () => {
    vi.stubEnv('ACTIVITY_LOG_ENABLED', 'true');

    await recordMcpToolCall(new Config(), details);
    await recordMcpToolCall(new Config(), details);

    expect(activityLogLines('warning')).toEqual([
      'ACTIVITY_LOG_DIRECTORY is not set, so Activity Log events go to the debug log and are not shipped.',
    ]);
  });

  it('logs an error once, and records nothing, when the SDK has no McpToolCall event', async () => {
    vi.stubEnv('ACTIVITY_LOG_ENABLED', 'true');
    vi.stubEnv('ACTIVITY_LOG_DIRECTORY', directory);
    hoisted.noMcpToolCall = true;

    await expect(recordMcpToolCall(new Config(), details)).resolves.toBeUndefined();
    await expect(recordMcpToolCall(new Config(), details)).resolves.toBeUndefined();

    const errors = activityLogLines('error');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('has no McpToolCall event');
    expect(hoisted.recorderCount).toBe(0);
  });

  it('sets up the recorder once and reuses it', async () => {
    vi.stubEnv('ACTIVITY_LOG_ENABLED', 'true');

    await recordMcpToolCall(new Config(), details);
    await recordMcpToolCall(new Config(), details);

    expect(hoisted.recorderCount).toBe(1);
  });

  it('skips the event when the call has no site or user LUID', async () => {
    vi.stubEnv('ACTIVITY_LOG_ENABLED', 'true');
    const record = vi.fn();
    hoisted.recordImpl = record;

    await recordMcpToolCall(new Config(), { ...details, userLuid: '' });

    expect(record).not.toHaveBeenCalled();
    expect(activityLogLines('debug')).toEqual([
      'Activity Log event skipped for list-workbooks: the call has no site or user LUID',
    ]);
  });

  it('warns when a LUID is present but malformed, since events are being lost', async () => {
    vi.stubEnv('ACTIVITY_LOG_ENABLED', 'true');
    vi.stubEnv('ACTIVITY_LOG_DIRECTORY', directory);
    const record = vi.fn();
    hoisted.recordImpl = record;

    await recordMcpToolCall(new Config(), { ...details, siteLuid: 'not-a-luid' });

    expect(record).not.toHaveBeenCalled();
    expect(activityLogLines('warning')).toEqual([
      'Activity Log event skipped for list-workbooks: the call has an invalid site or user LUID',
    ]);
  });

  it('never rejects when recording throws, and logs a warning', async () => {
    vi.stubEnv('ACTIVITY_LOG_ENABLED', 'true');
    vi.stubEnv('ACTIVITY_LOG_DIRECTORY', directory);
    hoisted.recordImpl = () => {
      throw new TypeError('bad event');
    };

    await expect(recordMcpToolCall(new Config(), details)).resolves.toBeUndefined();

    expect(activityLogLines('warning')).toEqual([
      'Activity Log recording failed for list-workbooks: bad event',
    ]);
  });

  it('never rejects when the site event file cannot be set up, and logs the error once', async () => {
    vi.stubEnv('ACTIVITY_LOG_ENABLED', 'true');
    // A directory path that runs through a regular file can't be created.
    const file = join(directory, 'not-a-directory');
    writeFileSync(file, '');
    vi.stubEnv('ACTIVITY_LOG_DIRECTORY', join(file, 'logs'));

    await expect(recordMcpToolCall(new Config(), details)).resolves.toBeUndefined();
    await expect(recordMcpToolCall(new Config(), details)).resolves.toBeUndefined();

    const errors = activityLogLines('error');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('Activity Log could not be set up');
  });
});
