import { generateKeyPairSync } from 'crypto';
import express from 'express';
import request from 'supertest';

import { SessionStore } from '../../sessionStore/sessionStore.js';
import { token } from './token.js';
import { AuthorizationCode, RefreshTokenData } from './types.js';

const mocks = vi.hoisted(() => ({
  mockGetTokenResult: vi.fn(),
}));

vi.mock('../../sdks/tableau-oauth/methods.js', () => ({
  getTokenResult: mocks.mockGetTokenResult,
}));

// token.ts transitively imports schemas.js -> passthroughAuthMiddleware.js -> restApi.js, which
// pulls in axios purely for its type. Stub it directly (no `importOriginal`) so this unit test
// doesn't depend on axios resolving -- it's unrelated to what this suite exercises.
vi.mock('../../sdks/tableau/restApi.js', () => ({ RestApi: class {} }));

/**
 * A minimal SessionStore double that lets a single test inject a failure on the next `set()`
 * call, so the write ordering between two namespaces can be exercised deterministically (a real
 * distributed backend would fail the same way mid-request).
 */
class FakeSessionStore<V> implements SessionStore<V> {
  readonly map = new Map<string, V>();
  failNextSet = false;

  get(key: string): Promise<V | undefined> {
    return Promise.resolve(this.map.get(key));
  }

  set(key: string, value: V): Promise<void> {
    if (this.failNextSet) {
      this.failNextSet = false;
      return Promise.reject(new Error('simulated backend failure during set'));
    }
    this.map.set(key, value);
    return Promise.resolve();
  }

  delete(key: string): Promise<void> {
    this.map.delete(key);
    return Promise.resolve();
  }

  consume(key: string): Promise<V | undefined> {
    const value = this.map.get(key);
    this.map.delete(key);
    return Promise.resolve(value);
  }
}

describe('refresh_token rotation write ordering', () => {
  const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });

  let authorizationCodes: SessionStore<AuthorizationCode>;
  let refreshTokens: FakeSessionStore<RefreshTokenData>;
  let refreshTokenIndex: FakeSessionStore<string>;
  let app: express.Application;

  const initialRefreshTokenId = 'initial-refresh-token-id';
  const initialAccessToken = 'initial-tableau-access-token';

  const refreshTokenData: RefreshTokenData = {
    user: { id: 'user-1', name: 'user-1' },
    clientId: 'test-client',
    server: 'https://my-tableau-server.com',
    tokens: {
      accessToken: initialAccessToken,
      refreshToken: 'initial-tableau-refresh-token',
      expiresInSeconds: 3600,
    },
    scopes: [],
    siteContentUrl: 'site',
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
    tableauClientId: 'tableau-client',
  };

  beforeEach(() => {
    vi.clearAllMocks();

    authorizationCodes = new FakeSessionStore<AuthorizationCode>();
    refreshTokens = new FakeSessionStore<RefreshTokenData>();
    refreshTokenIndex = new FakeSessionStore<string>();

    refreshTokens.map.set(initialRefreshTokenId, refreshTokenData);
    refreshTokenIndex.map.set(initialAccessToken, initialRefreshTokenId);

    mocks.mockGetTokenResult.mockResolvedValue({
      accessToken: 'rotated-tableau-access-token',
      refreshToken: 'rotated-tableau-refresh-token',
      expiresInSeconds: 3600,
      originHost: '10ax.online.tableau.com',
    });

    app = express();
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));
    token(app, authorizationCodes, refreshTokens, publicKey, refreshTokenIndex);
  });

  it('writes refreshTokenIndex before refreshTokens', async () => {
    const writeOrder: string[] = [];
    const indexSet = refreshTokenIndex.set.bind(refreshTokenIndex);
    const tokensSet = refreshTokens.set.bind(refreshTokens);
    refreshTokenIndex.set = (...args) => {
      writeOrder.push('refreshTokenIndex');
      return indexSet(...args);
    };
    refreshTokens.set = (...args) => {
      writeOrder.push('refreshTokens');
      return tokensSet(...args);
    };

    const response = await request(app).post('/oauth2/token').send({
      grant_type: 'refresh_token',
      refresh_token: initialRefreshTokenId,
    });

    expect(response.status).toBe(200);
    expect(writeOrder).toEqual(['refreshTokenIndex', 'refreshTokens']);
  });

  it('never leaves a live, unindexed refresh token when the second write fails mid-rotation', async () => {
    // Simulate a crash/backend failure on the SECOND write (refreshTokens.set, per the fixed
    // ordering). If the ordering regressed back to refreshTokens-first, this would instead be
    // simulating a failure on refreshTokenIndex and reproducing the reported bug.
    refreshTokens.failNextSet = true;

    const response = await request(app).post('/oauth2/token').send({
      grant_type: 'refresh_token',
      refresh_token: initialRefreshTokenId,
    });

    // The request fails server-side once the second write rejects.
    expect(response.status).toBe(500);

    // The old refresh token was already consumed at the top of the handler, so it's gone
    // either way -- that's expected and not the risk this test guards against.
    expect(refreshTokens.map.has(initialRefreshTokenId)).toBe(false);

    // The critical invariant this fix protects: no refreshTokens entry may exist without a
    // reverse index entry pointing to it -- that's the unrevocable-until-TTL state the
    // reviewer flagged. Since the index write landed but the refreshTokens write did not, the
    // new refresh token was simply never created, so this assertion holds vacuously in this
    // specific scenario -- it is a defensive invariant check, not a regression guard for the
    // write order itself (the "writes refreshTokenIndex before refreshTokens" test above is
    // what catches that).
    for (const [refreshTokenId, data] of refreshTokens.map) {
      const indexedId = refreshTokenIndex.map.get(data.tokens.accessToken);
      expect(indexedId).toBe(refreshTokenId);
    }
  });
});
