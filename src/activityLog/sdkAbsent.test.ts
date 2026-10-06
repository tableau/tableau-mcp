import { Config } from '../config.js';
import { stubDefaultEnvVars } from '../testShared.js';

vi.mock('../logging/logger.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../logging/logger.js')>();
  return { ...actual, log: vi.fn() };
});

import { log } from '../logging/logger.js';
import { recordMcpToolCall, resetActivityLog } from './index.js';
import { loadCeppSdk } from './sdk.js';

const mockedLog = vi.mocked(log);

// This file deliberately does NOT mock the CEPP SDK. It isn't installed here, so the dynamic
// import() really rejects: the path every external install and public CI run takes.
describe('CEPP SDK not installed', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    stubDefaultEnvVars();
    mockedLog.mockClear();
    resetActivityLog();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('loadCeppSdk resolves to null', async () => {
    await expect(loadCeppSdk()).resolves.toBeNull();
  });

  it('recordMcpToolCall does nothing and warns once, with ACTIVITY_LOG_ENABLED on', async () => {
    vi.stubEnv('ACTIVITY_LOG_ENABLED', 'true');
    const details = {
      toolName: 'list-workbooks',
      siteLuid: '11111111-2222-3333-4444-555555555555',
      userLuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      success: true,
      errorCode: '',
      oauthClientId: undefined,
      userAgent: undefined,
      mcpRequestId: '1',
      object: undefined,
    };

    await expect(recordMcpToolCall(new Config(), details)).resolves.toBeUndefined();
    await expect(recordMcpToolCall(new Config(), details)).resolves.toBeUndefined();

    expect(mockedLog).toHaveBeenCalledTimes(1);
    expect(mockedLog.mock.calls[0][0]).toMatchObject({
      level: 'warning',
      logger: 'activityLog',
      message: expect.stringContaining('is not installed'),
    });
  });
});
