import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTableauServerInfo } from './getTableauServerInfo.js';
import { ServerMethods } from './sdks/tableau/methods/serverMethods.js';
import { RestApi } from './sdks/tableau/restApi.js';

vi.mock('./sdks/tableau/methods/serverMethods.js', () => ({
  ServerMethods: vi.fn(),
}));

const mockHost = 'https://my-tableau-server.com';
const mockRestApiVersion = '3.27';
const mockProductVersion = { value: '2026.1.0', build: '20261.26.0211.1127' };

function setupServerMethodsMock(
  overrides?: Partial<{ getServerInfo: () => Promise<unknown> }>,
): void {
  vi.mocked(ServerMethods).mockImplementation(
    () =>
      ({
        getServerInfo:
          overrides?.getServerInfo ??
          vi.fn().mockResolvedValue({
            restApiVersion: mockRestApiVersion,
            productVersion: mockProductVersion,
          }),
      }) as unknown as ServerMethods,
  );
}

describe('getTableauServerInfo', () => {
  beforeEach(() => {
    // Set host on the mock RestApi class (it's vi.fn(), so we can set plain properties)
    (RestApi as unknown as Record<string, unknown>).host = mockHost;
    // Reset version to ensure we're not relying on previously set state
    (RestApi as unknown as Record<string, unknown>).version = undefined;
    setupServerMethodsMock();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('constructs ServerMethods with the bootstrap API version URL, not RestApi.version', async () => {
    // RestApi.version is unset -- if the implementation used RestApi.version it would throw.
    // This test verifies it uses the explicit bootstrap version instead.
    await getTableauServerInfo('unique-server-bootstrap-test.com');

    expect(ServerMethods).toHaveBeenCalledWith(`${mockHost}/api/3.24`, expect.any(Object));
  });

  it('sets RestApi.version from the server response', async () => {
    await getTableauServerInfo('unique-server-version-test.com');

    expect((RestApi as unknown as Record<string, unknown>).version).toBe(mockRestApiVersion);
  });

  it('returns the server info from the response', async () => {
    const result = await getTableauServerInfo('unique-server-result-test.com');

    expect(result).toEqual({
      restApiVersion: mockRestApiVersion,
      productVersion: mockProductVersion,
    });
  });

  it('throws a descriptive error when getServerInfo fails', async () => {
    setupServerMethodsMock({
      getServerInfo: vi.fn().mockRejectedValue(new Error('Connection refused')),
    });

    await expect(getTableauServerInfo('unique-server-error-test.com')).rejects.toThrow(
      'Failed to get server info',
    );
  });

  it('returns cached server info on subsequent calls with the same server', async () => {
    const server = 'unique-server-cache-test.com';
    await getTableauServerInfo(server);
    await getTableauServerInfo(server);

    expect(ServerMethods).toHaveBeenCalledTimes(1);
  });
});
