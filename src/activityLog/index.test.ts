import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Config } from '../config.js';
import { stubDefaultEnvVars } from '../testShared.js';

vi.mock('../logging/logger.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../logging/logger.js')>();
  return { ...actual, log: vi.fn() };
});

import { log } from '../logging/logger.js';
import { ACTIVITY_LOG_LOGGER, recordActivityLogEvent } from './index.js';

const mockedLog = vi.mocked(log);

const CTX = {
  siteLuid: '11111111-1111-1111-1111-111111111111',
  userLuid: '22222222-2222-2222-2222-222222222222',
  toolName: 'list-projects',
};

describe('recordActivityLogEvent', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    stubDefaultEnvVars();
    mockedLog.mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('builds and records the event when ACTIVITY_LOG_ENABLED is on', () => {
    vi.stubEnv('ACTIVITY_LOG_ENABLED', 'true');

    recordActivityLogEvent(new Config(), CTX);

    expect(mockedLog).toHaveBeenCalledTimes(1);
    expect(mockedLog).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'debug',
        logger: ACTIVITY_LOG_LOGGER,
        data: expect.objectContaining({
          event: expect.objectContaining({ toolName: 'list-projects' }),
        }),
      }),
    );
  });

  it('is a no-op when ACTIVITY_LOG_ENABLED is off', () => {
    recordActivityLogEvent(new Config(), CTX);

    expect(mockedLog).not.toHaveBeenCalled();
  });

  it('never throws when the event context is invalid, even with the flag on', () => {
    vi.stubEnv('ACTIVITY_LOG_ENABLED', 'true');

    expect(() =>
      recordActivityLogEvent(new Config(), { ...CTX, siteLuid: 'not-a-luid' }),
    ).not.toThrow();
    // Build failed before reaching the sink, so nothing was recorded.
    expect(mockedLog).not.toHaveBeenCalled();
  });
});
