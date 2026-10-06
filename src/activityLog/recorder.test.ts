import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Config } from '../config.js';
import { stubDefaultEnvVars } from '../testShared.js';
import { ACTIVITY_LOG_LOGGER, createActivityLogRecorder, serverCeppLogger } from './recorder.js';
import { CeppEventLoggingRecorderOptions, CeppSdkRootModule } from './sdkTypes.js';
import { SITE_EVENT_FILE_NAME, SiteEventFileSink } from './siteEventFileSink.js';

vi.mock('../logging/logger.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../logging/logger.js')>();
  return { ...actual, log: vi.fn() };
});

import { log } from '../logging/logger.js';

const mockedLog = vi.mocked(log);

// Captures the options the recorder is built with.
class FakeCeppEventLoggingRecorder {
  constructor(readonly options: CeppEventLoggingRecorderOptions) {}
  record(): void {}
}
const sdk = { CeppEventLoggingRecorder: FakeCeppEventLoggingRecorder } as CeppSdkRootModule;

function optionsFor(config: Config): CeppEventLoggingRecorderOptions {
  return (createActivityLogRecorder(config, sdk) as FakeCeppEventLoggingRecorder).options;
}

describe('createActivityLogRecorder', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    stubDefaultEnvVars();
    mockedLog.mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('builds the recorder for Tableau Cloud with I/O errors suppressed', () => {
    vi.stubEnv('ACTIVITY_LOG_ENABLED', 'true');

    expect(optionsFor(new Config()).config).toEqual({
      recordingEnabled: true,
      tableauOnline: true,
      ioErrorSuppressionEnabled: true,
    });
  });

  it('turns recording off when ACTIVITY_LOG_ENABLED is off', () => {
    expect(optionsFor(new Config()).config.recordingEnabled).toBe(false);
  });

  it('sends site events to the logger when ACTIVITY_LOG_DIRECTORY is not set', () => {
    const options = optionsFor(new Config());

    expect(options.siteLogger).toBe(serverCeppLogger);
    expect(options.logger).toBe(serverCeppLogger);
    expect(options.tenantLogger).toBe(serverCeppLogger);
  });

  it('sends site events to the site event file when ACTIVITY_LOG_DIRECTORY is set', () => {
    const directory = mkdtempSync(join(tmpdir(), 'activity-log-'));
    try {
      vi.stubEnv('ACTIVITY_LOG_DIRECTORY', directory);

      const { siteLogger, logger } = optionsFor(new Config());

      expect(siteLogger).toBeInstanceOf(SiteEventFileSink);
      expect((siteLogger as SiteEventFileSink).filePath).toBe(
        join(directory, SITE_EVENT_FILE_NAME),
      );
      expect(logger).toBe(serverCeppLogger);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe('serverCeppLogger', () => {
  beforeEach(() => {
    mockedLog.mockClear();
  });

  it('logs info at debug, warn at warning and error at error', () => {
    serverCeppLogger.info('recorded');
    serverCeppLogger.warn('suppressed');
    serverCeppLogger.error('failed');

    expect(mockedLog.mock.calls.map(([entry]) => entry)).toEqual([
      { message: 'recorded', level: 'debug', logger: ACTIVITY_LOG_LOGGER },
      { message: 'suppressed', level: 'warning', logger: ACTIVITY_LOG_LOGGER },
      { message: 'failed', level: 'error', logger: ACTIVITY_LOG_LOGGER },
    ]);
  });
});
