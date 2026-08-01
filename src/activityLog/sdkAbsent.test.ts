import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Config } from '../config.js';
import { stubDefaultEnvVars } from '../testShared.js';

vi.mock('../logging/logger.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../logging/logger.js')>();
  return { ...actual, log: vi.fn() };
});

import { log } from '../logging/logger.js';
import { buildActivityLogSettingsChangeEvent } from './eventBuilder.js';
import { ACTIVITY_LOG_LOGGER, recordActivityLogEvent } from './index.js';
import { createActivityLogRecorder } from './recorder.js';

const mockedLog = vi.mocked(log);

// This file deliberately does NOT vi.mock the CEPP SDK. The package is not installed here
// (it's internal/Nexus-only), so the dynamic import() genuinely rejects — exercising the
// real external-deployment / public-CI path where ActivityLog must silently no-op.
describe('CEPP SDK absent (external installs / public CI)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    stubDefaultEnvVars();
    mockedLog.mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('createActivityLogRecorder resolves to null', async () => {
    vi.stubEnv('ACTIVITY_LOG_ENABLED', 'true');
    await expect(createActivityLogRecorder(new Config())).resolves.toBeNull();
  });

  it('buildActivityLogSettingsChangeEvent resolves to null', async () => {
    await expect(buildActivityLogSettingsChangeEvent()).resolves.toBeNull();
  });

  it('recordActivityLogEvent no-ops without throwing, even with the flag on', async () => {
    vi.stubEnv('ACTIVITY_LOG_ENABLED', 'true');

    await expect(recordActivityLogEvent(new Config())).resolves.toBeUndefined();
  });

  it('emits a diagnostic breadcrumb when enabled but the SDK is absent', async () => {
    vi.stubEnv('ACTIVITY_LOG_ENABLED', 'true');

    await recordActivityLogEvent(new Config());

    const unavailableCalls = mockedLog.mock.calls.filter(
      ([entry]) =>
        entry.logger === ACTIVITY_LOG_LOGGER &&
        typeof entry.message === 'string' &&
        entry.message.includes('CEPP SDK could not be loaded'),
    );
    expect(unavailableCalls).toHaveLength(1);
    expect(unavailableCalls[0][0].level).toBe('debug');
  });
});
