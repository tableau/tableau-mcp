import { generateKeyPairSync, KeyObject } from 'crypto';
import { CompactEncrypt } from 'jose';

import { getTelemetryProvider } from '../../telemetry/init.js';
import { tryRevokeAccessToken } from './revoke.js';
import { RefreshTokenData } from './types.js';

vi.mock('../../telemetry/init.js', () => ({
  getTelemetryProvider: vi.fn(),
}));

async function encryptAccessTokenPayload(
  payload: Record<string, unknown>,
  publicKey: KeyObject,
): Promise<string> {
  return await new CompactEncrypt(new TextEncoder().encode(JSON.stringify(payload)))
    .setProtectedHeader({ alg: 'RSA-OAEP-256', enc: 'A256GCM' })
    .encrypt(publicKey);
}

describe('tryRevokeAccessToken', () => {
  let privateKey: KeyObject;
  let publicKey: KeyObject;

  const fullTokenPayload = {
    iss: 'https://mcp.example.com',
    aud: 'tableau-mcp-server',
    exp: 9999999999,
    sub: 'user@example.com',
    clientId: 'test-client-id',
    tableauServer: 'https://my-tableau-server.com',
    tableauAccessToken: 'tableau-access-token',
    tableauRefreshToken: 'tableau-refresh-token',
    tableauExpiresAt: 9999999999,
    tableauUserId: 'user-luid-123',
  };

  beforeAll(() => {
    ({ privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 }));
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('starts and ends a span around the Tableau signout fetch on success', async () => {
    const mockSpan = { end: vi.fn() };
    const mockProvider = {
      initialize: vi.fn(),
      recordMetric: vi.fn(),
      recordHistogram: vi.fn(),
      startSpan: vi.fn().mockReturnValue(mockSpan),
    };
    vi.mocked(getTelemetryProvider).mockReturnValue(mockProvider);

    const mockFetch = vi.fn().mockResolvedValue(new Response('', { status: 200 }));
    vi.stubGlobal('fetch', mockFetch);

    const token = await encryptAccessTokenPayload(fullTokenPayload, publicKey);

    await tryRevokeAccessToken(
      token,
      privateKey,
      new Map<string, RefreshTokenData>(),
      new Map<string, string>(),
    );

    expect(mockProvider.startSpan).toHaveBeenCalledWith('tableau.oauth.signout', {
      server: 'https://my-tableau-server.com',
    });
    expect(mockFetch).toHaveBeenCalledWith('https://my-tableau-server.com/api/3.24/auth/signout', {
      method: 'POST',
      headers: { 'X-Tableau-Auth': 'tableau-access-token' },
    });
    expect(mockSpan.end).toHaveBeenCalledWith(undefined);
  });

  it('ends the span with the error when the upstream signout fetch fails', async () => {
    const mockSpan = { end: vi.fn() };
    const mockProvider = {
      initialize: vi.fn(),
      recordMetric: vi.fn(),
      recordHistogram: vi.fn(),
      startSpan: vi.fn().mockReturnValue(mockSpan),
    };
    vi.mocked(getTelemetryProvider).mockReturnValue(mockProvider);

    const fetchError = new Error('network error');
    const mockFetch = vi.fn().mockRejectedValue(fetchError);
    vi.stubGlobal('fetch', mockFetch);

    const token = await encryptAccessTokenPayload(fullTokenPayload, publicKey);

    await tryRevokeAccessToken(
      token,
      privateKey,
      new Map<string, RefreshTokenData>(),
      new Map<string, string>(),
    );

    expect(mockSpan.end).toHaveBeenCalledWith(fetchError);
  });

  it('does not start a span when there is no upstream Tableau session to sign out of', async () => {
    const mockProvider = {
      initialize: vi.fn(),
      recordMetric: vi.fn(),
      recordHistogram: vi.fn(),
      startSpan: vi.fn(),
    };
    vi.mocked(getTelemetryProvider).mockReturnValue(mockProvider);

    // Client-credentials-style token: no tableauAccessToken, so there is no upstream session.
    const token = await encryptAccessTokenPayload(
      {
        iss: 'https://mcp.example.com',
        aud: 'tableau-mcp-server',
        exp: 9999999999,
        sub: 'test-client-id',
        clientId: 'test-client-id',
        tableauServer: 'https://my-tableau-server.com',
      },
      publicKey,
    );

    await tryRevokeAccessToken(
      token,
      privateKey,
      new Map<string, RefreshTokenData>(),
      new Map<string, string>(),
    );

    expect(mockProvider.startSpan).not.toHaveBeenCalled();
  });
});
