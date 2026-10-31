import { getTelemetryProvider } from '../../telemetry/init.js';
import { getClient } from './client.js';
import { getTokenResult } from './methods.js';
import { TableauAccessTokenRequest } from './types.js';

vi.mock('./client.js', () => ({
  getClient: vi.fn(),
}));

vi.mock('../../telemetry/init.js', () => ({
  getTelemetryProvider: vi.fn(),
}));

describe('getTokenResult', () => {
  const basePath = 'https://my-tableau-server.com';
  const request: TableauAccessTokenRequest = {
    grant_type: 'refresh_token',
    client_id: 'test-client-id',
    refresh_token: 'test-refresh-token',
    site_namespace: 'test-site',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('starts and ends a span around the token exchange call on success', async () => {
    const mockSpan = { end: vi.fn() };
    const mockProvider = {
      initialize: vi.fn(),
      recordMetric: vi.fn(),
      recordHistogram: vi.fn(),
      startSpan: vi.fn().mockReturnValue(mockSpan),
    };
    vi.mocked(getTelemetryProvider).mockReturnValue(mockProvider);

    const mockToken = vi.fn().mockResolvedValue({
      accessToken: 'access-token',
      expiresInSeconds: 3600,
      refreshToken: 'new-refresh-token',
      originHost: 'my-tableau-server.com',
    });
    vi.mocked(getClient).mockReturnValue({ token: mockToken } as any);

    const result = await getTokenResult(basePath, request, {});

    expect(mockProvider.startSpan).toHaveBeenCalledWith('tableau.oauth.token_exchange', {
      basePath,
    });
    expect(mockToken).toHaveBeenCalledWith(request, {
      headers: expect.objectContaining({
        'Content-Type': 'application/x-www-form-urlencoded',
      }),
    });
    expect(mockSpan.end).toHaveBeenCalledWith(undefined);
    expect(result.accessToken).toBe('access-token');
  });

  it('ends the span with the error and rethrows when the token exchange fails', async () => {
    const mockSpan = { end: vi.fn() };
    const mockProvider = {
      initialize: vi.fn(),
      recordMetric: vi.fn(),
      recordHistogram: vi.fn(),
      startSpan: vi.fn().mockReturnValue(mockSpan),
    };
    vi.mocked(getTelemetryProvider).mockReturnValue(mockProvider);

    const tokenError = new Error('token exchange failed');
    const mockToken = vi.fn().mockRejectedValue(tokenError);
    vi.mocked(getClient).mockReturnValue({ token: mockToken } as any);

    await expect(getTokenResult(basePath, request, {})).rejects.toBe(tokenError);

    expect(mockSpan.end).toHaveBeenCalledWith(tokenError);
  });

  it('does not throw when the provider has no startSpan (feature-detection fallback)', async () => {
    vi.mocked(getTelemetryProvider).mockReturnValue({
      initialize: vi.fn(),
      recordMetric: vi.fn(),
      recordHistogram: vi.fn(),
    });

    const mockToken = vi.fn().mockResolvedValue({
      accessToken: 'access-token',
      expiresInSeconds: 3600,
      refreshToken: 'new-refresh-token',
      originHost: 'my-tableau-server.com',
    });
    vi.mocked(getClient).mockReturnValue({ token: mockToken } as any);

    await expect(getTokenResult(basePath, request, {})).resolves.toEqual({
      accessToken: 'access-token',
      expiresInSeconds: 3600,
      refreshToken: 'new-refresh-token',
      originHost: 'my-tableau-server.com',
    });
  });
});
