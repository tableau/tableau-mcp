import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getConfig } from './config.js';
import { Logger } from './logging/logger.js';
import { notifier } from './logging/notification.js';
import {
  getRequestErrorInterceptor,
  getRequestInterceptor,
  getResponseErrorInterceptor,
  getResponseInterceptor,
  useRestApi,
} from './restApiInstance.js';
import { RestApi } from './sdks/tableau/restApi.js';
import { WebMcpServer } from './server.web.js';

vi.mock('./logging/notification.js', () => ({
  notifier: {
    info: vi.fn(),
    error: vi.fn(),
  },
  shouldNotifyWhenLevelIsAtLeast: vi.fn().mockReturnValue(true),
}));

describe('restApiInstance', () => {
  const mockHost = 'https://my-tableau-server.com';
  const mockRequestId = 'test-request-id';

  beforeAll(() => {
    RestApi.host = mockHost;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.stubEnv('SERVER', mockHost);
    vi.stubEnv('SITE_NAME', 'tc25');
    vi.stubEnv('PAT_NAME', 'sponge');
    vi.stubEnv('PAT_VALUE', 'bob');
  });

  describe('useRestApi', () => {
    it('should sign in with PAT when auth is PAT', async () => {
      vi.stubEnv('AUTH', 'pat');

      const restApi = await useRestApi({
        config: getConfig(),
        requestId: mockRequestId,
        server: new WebMcpServer(),
        tableauAuthInfo: undefined,
        jwtScopes: [],
        signal: new AbortController().signal,
        callback: (restApi) => Promise.resolve(restApi),
      });

      expect(RestApi.host).toBe(mockHost);
      expect(restApi.signIn).toHaveBeenCalledWith({
        type: 'pat',
        patName: 'sponge',
        patValue: 'bob',
        siteName: 'tc25',
      });
      expect(restApi.signOut).toHaveBeenCalled();
    });

    it('should sign in with Direct Trust when auth is Direct Trust', async () => {
      vi.stubEnv('AUTH', 'direct-trust');
      vi.stubEnv('JWT_SUB_CLAIM', 'test-jwt-sub-claim');
      vi.stubEnv('CONNECTED_APP_CLIENT_ID', 'test-client-id');
      vi.stubEnv('CONNECTED_APP_SECRET_ID', 'test-secret-id');
      vi.stubEnv('CONNECTED_APP_SECRET_VALUE', 'test-secret-value');

      const restApi = await useRestApi({
        config: getConfig(),
        requestId: mockRequestId,
        server: new WebMcpServer(),
        tableauAuthInfo: undefined,
        jwtScopes: [],
        signal: new AbortController().signal,
        callback: (restApi) => Promise.resolve(restApi),
      });

      expect(RestApi.host).toBe(mockHost);
      expect(restApi.signIn).toHaveBeenCalledWith({
        type: 'direct-trust',
        siteName: 'tc25',
        username: 'test-jwt-sub-claim',
        clientId: 'test-client-id',
        secretId: 'test-secret-id',
        secretValue: 'test-secret-value',
        scopes: new Set(),
        additionalPayload: {},
      });
      expect(restApi.signOut).toHaveBeenCalled();
    });

    it('should sign in with UAT when auth is UAT', async () => {
      vi.stubEnv('AUTH', 'uat');
      vi.stubEnv('UAT_TENANT_ID', 'test-tenant-id');
      vi.stubEnv('UAT_ISSUER', 'test-issuer');
      vi.stubEnv('UAT_USERNAME_CLAIM', 'test-username-claim');
      vi.stubEnv('UAT_USERNAME_CLAIM_NAME', 'test-username-claim-name');
      vi.stubEnv('UAT_PRIVATE_KEY', 'test-private-key');
      vi.stubEnv('UAT_KEY_ID', 'test-key-id');

      const restApi = await useRestApi({
        config: getConfig(),
        requestId: mockRequestId,
        server: new WebMcpServer(),
        tableauAuthInfo: undefined,
        jwtScopes: [],
        signal: new AbortController().signal,
        callback: (restApi) => Promise.resolve(restApi),
      });

      expect(RestApi.host).toBe(mockHost);
      expect(restApi.signIn).toHaveBeenCalledWith({
        type: 'uat',
        siteName: 'tc25',
        username: 'test-username-claim',
        tenantId: 'test-tenant-id',
        issuer: 'test-issuer',
        usernameClaimName: 'test-username-claim-name',
        privateKey: 'test-private-key',
        keyId: 'test-key-id',
        scopes: new Set(),
        additionalPayload: {},
      });
      expect(restApi.signOut).toHaveBeenCalled();
    });

    it('should set bearer token when auth is OAuth with Bearer token', async () => {
      vi.stubEnv('AUTH', 'oauth');
      vi.stubEnv('OAUTH_ISSUER', 'http://127.0.0.1:3927');
      vi.stubEnv('OAUTH_JWE_PRIVATE_KEY', 'test-private-key');

      const restApi = await useRestApi({
        config: getConfig(),
        requestId: mockRequestId,
        server: new WebMcpServer(),
        tableauAuthInfo: {
          type: 'Bearer',
          username: 'test-user',
          server: 'https://my-tableau-server.com',
          siteId: 'site-luid',
          siteName: 'test-site',
          raw: 'abc123|xyz789|site-luid',
        },
        jwtScopes: [],
        signal: new AbortController().signal,
        callback: (restApi) => Promise.resolve(restApi),
      });

      expect(RestApi.host).toBe(mockHost);
      expect(restApi.setBearerToken).toHaveBeenCalledWith('abc123|xyz789|site-luid');
      expect(restApi.signIn).not.toHaveBeenCalled();
      expect(restApi.signOut).not.toHaveBeenCalled();
    });

    it('should set credentials when auth is OAuth with X-Tableau-Auth token', async () => {
      vi.stubEnv('AUTH', 'oauth');
      vi.stubEnv('OAUTH_ISSUER', 'http://127.0.0.1:3927');
      vi.stubEnv('OAUTH_JWE_PRIVATE_KEY', 'test-private-key');

      const restApi = await useRestApi({
        config: getConfig(),
        requestId: mockRequestId,
        server: new WebMcpServer(),
        tableauAuthInfo: {
          type: 'X-Tableau-Auth',
          username: 'test-user',
          userId: 'user-luid-123',
          server: 'https://my-tableau-server.com',
          siteName: 'test-site',
          accessToken: 'abc123|xyz789|site-luid',
          refreshToken: 'refresh-token-123',
        },
        jwtScopes: [],
        signal: new AbortController().signal,
        callback: (restApi) => Promise.resolve(restApi),
      });

      expect(RestApi.host).toBe(mockHost);
      expect(restApi.setCredentials).toHaveBeenCalledWith(
        'abc123|xyz789|site-luid',
        'user-luid-123',
      );
      expect(restApi.signIn).not.toHaveBeenCalled();
      expect(restApi.signOut).not.toHaveBeenCalled();
    });

    // W-23202034: a sign-out failure during teardown must not mask the callback's real result or
    // error. A throw in the `finally` sign-out would otherwise replace whatever the callback
    // returned/threw — e.g. a 404 from a missing resource surfacing to the caller as the sign-out's
    // 401. Sign-out is best-effort cleanup; its failure is swallowed and logged.
    it('should not let a sign-out failure mask the callback error', async () => {
      vi.stubEnv('AUTH', 'pat');

      const callbackError = new Error('Request failed with status code 404');

      await expect(
        useRestApi({
          config: getConfig(),
          requestId: mockRequestId,
          server: new WebMcpServer(),
          tableauAuthInfo: undefined,
          jwtScopes: [],
          signal: new AbortController().signal,
          callback: (restApi) => {
            // Simulate the ephemeral session being torn down: sign-out now rejects (e.g. 401).
            vi.mocked(restApi.signOut).mockRejectedValueOnce(
              new Error('Request failed with status code 401'),
            );
            // The real failure the caller cares about.
            return Promise.reject(callbackError);
          },
        }),
        // The caller must see the callback's 404, NOT the sign-out's 401.
      ).rejects.toBe(callbackError);
    });

    it('should not let a sign-out failure mask a successful callback result', async () => {
      vi.stubEnv('AUTH', 'pat');

      const result = await useRestApi({
        config: getConfig(),
        requestId: mockRequestId,
        server: new WebMcpServer(),
        tableauAuthInfo: undefined,
        jwtScopes: [],
        signal: new AbortController().signal,
        callback: (restApi) => {
          vi.mocked(restApi.signOut).mockRejectedValueOnce(
            new Error('Request failed with status code 401'),
          );
          return Promise.resolve('ok');
        },
      });

      // A best-effort sign-out failure is swallowed; the successful result still reaches the caller.
      expect(result).toBe('ok');
    });

    it('should set credentials when using Passthrough auth', async () => {
      vi.stubEnv('AUTH', 'pat');

      const restApi = await useRestApi({
        config: getConfig(),
        requestId: mockRequestId,
        server: new WebMcpServer(),
        tableauAuthInfo: {
          type: 'Passthrough',
          username: 'test-user',
          userId: 'user-luid-123',
          server: 'https://my-tableau-server.com',
          siteId: 'site-luid',
          siteName: 'test-site',
          raw: 'abc123|xyz789|site-luid',
        },
        jwtScopes: [],
        signal: new AbortController().signal,
        callback: (restApi: RestApi) => Promise.resolve(restApi),
      });

      expect(restApi.setCredentials).toHaveBeenCalledWith(
        'abc123|xyz789|site-luid',
        'user-luid-123',
      );

      expect(restApi.signIn).not.toHaveBeenCalled();
      expect(restApi.signOut).not.toHaveBeenCalled();
    });
  });

  describe('Request Interceptor', () => {
    it('should add User-Agent header and log request', () => {
      const server = new WebMcpServer();
      const interceptor = getRequestInterceptor(server, mockRequestId);
      const mockRequest = {
        headers: {} as Record<string, string>,
        method: 'GET',
        url: '/api/test',
        baseUrl: mockHost,
      };

      interceptor(mockRequest);

      expect(mockRequest.headers['User-Agent']).toBe(server.userAgent);
      expect(notifier.info).toHaveBeenCalledWith(
        server.mcpServer,
        expect.objectContaining({
          type: 'request',
          requestId: mockRequestId,
          method: 'GET',
          url: expect.any(String),
        }),
        expect.objectContaining({
          notifier: 'rest-api',
          requestId: mockRequestId,
        }),
      );
    });
  });

  describe('Response Interceptor', () => {
    it('should log response', () => {
      const server = new WebMcpServer();
      const interceptor = getResponseInterceptor(server, mockRequestId);
      const mockResponse = {
        status: 200,
        url: '/api/test',
        baseUrl: mockHost,
        params: {},
        headers: {},
        data: {},
      };

      const result = interceptor(mockResponse);

      expect(result).toBe(mockResponse);
      expect(notifier.info).toHaveBeenCalledWith(
        server.mcpServer,
        expect.objectContaining({
          type: 'response',
          requestId: mockRequestId,
          status: 200,
          url: expect.any(String),
        }),
        expect.objectContaining({
          notifier: 'rest-api',
          requestId: mockRequestId,
        }),
      );
    });
  });

  describe('Error Handling', () => {
    it('should handle request errors', () => {
      const server = new WebMcpServer();
      const errorInterceptor = getRequestErrorInterceptor(server, mockRequestId);
      const mockError = {
        request: {
          method: 'GET',
          url: '/api/test',
          baseUrl: mockHost,
          headers: {},
        },
      };

      errorInterceptor(mockError, mockHost);

      expect(notifier.error).toHaveBeenCalledWith(
        server.mcpServer,
        `Request ${mockRequestId} failed with error: ${JSON.stringify(mockError)}`,
        expect.objectContaining({
          notifier: 'rest-api',
          requestId: mockRequestId,
        }),
      );
    });

    it('should handle AxiosError request errors', () => {
      const server = new WebMcpServer();
      const errorInterceptor = getRequestErrorInterceptor(server, mockRequestId);
      const mockError = {
        isAxiosError: true,
        request: {
          method: 'GET',
          url: '/api/test',
          baseUrl: mockHost,
          headers: {},
        },
      };

      errorInterceptor(mockError, mockHost);

      expect(notifier.info).toHaveBeenCalled();

      expect(notifier.info).toHaveBeenCalledWith(
        server.mcpServer,
        expect.objectContaining({
          type: 'request',
          requestId: mockRequestId,
          method: 'GET',
          url: expect.any(String),
        }),
        expect.objectContaining({
          notifier: 'rest-api',
          requestId: mockRequestId,
        }),
      );
    });

    it('should handle response errors', () => {
      const server = new WebMcpServer();
      const errorInterceptor = getResponseErrorInterceptor(server, mockRequestId);
      const mockError = {
        response: {
          status: 500,
          url: '/api/test',
          baseUrl: mockHost,
          headers: {},
          data: {},
        },
      };

      errorInterceptor(mockError, mockHost);

      expect(notifier.error).toHaveBeenCalledWith(
        server.mcpServer,
        `Response from request ${mockRequestId} failed with error: ${JSON.stringify(mockError)}`,
        expect.objectContaining({
          notifier: 'rest-api',
          requestId: mockRequestId,
        }),
      );
    });

    it('should handle AxiosError response errors', () => {
      const server = new WebMcpServer();
      const errorInterceptor = getResponseErrorInterceptor(server, mockRequestId);
      const mockError = {
        isAxiosError: true,
        response: {
          status: 500,
          url: '/api/test',
          baseUrl: mockHost,
          headers: {},
          data: {},
          config: {},
        },
      };

      errorInterceptor(mockError, mockHost);

      expect(notifier.info).toHaveBeenCalledWith(
        server.mcpServer,
        expect.objectContaining({
          type: 'response',
          requestId: mockRequestId,
          url: expect.any(String),
          status: 500,
        }),
        expect.objectContaining({
          notifier: 'rest-api',
          requestId: mockRequestId,
        }),
      );
    });
  });

  describe('Bound Logger Integration', () => {
    it('should use bound logger for sign-out logs with populated LUIDs', async () => {
      vi.stubEnv('AUTH', 'pat');

      const mockLogFn = vi.fn();
      const boundLogger = new Logger({
        getSiteLuid: () => 'test-site-luid',
        getUserLuid: () => 'test-user-luid',
      });
      boundLogger.log = mockLogFn;

      await useRestApi({
        config: getConfig(),
        requestId: mockRequestId,
        server: new WebMcpServer(),
        tableauAuthInfo: undefined,
        jwtScopes: [],
        signal: new AbortController().signal,
        logger: boundLogger,
        callback: (restApi) => Promise.resolve(restApi),
      });

      // Verify sign-out success log was called with the bound logger
      expect(mockLogFn).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Signed out of Tableau REST API',
          level: 'debug',
          logger: 'auth',
        }),
      );
    });

    it('should use bound logger for sign-out failure logs with populated LUIDs', async () => {
      vi.stubEnv('AUTH', 'pat');

      const mockLogFn = vi.fn();
      const boundLogger = new Logger({
        getSiteLuid: () => 'test-site-luid',
        getUserLuid: () => 'test-user-luid',
      });
      boundLogger.log = mockLogFn;

      await useRestApi({
        config: getConfig(),
        requestId: mockRequestId,
        server: new WebMcpServer(),
        tableauAuthInfo: undefined,
        jwtScopes: [],
        signal: new AbortController().signal,
        logger: boundLogger,
        callback: (restApi) => {
          vi.mocked(restApi.signOut).mockRejectedValueOnce(new Error('Sign-out failed'));
          return Promise.resolve('ok');
        },
      });

      // Verify sign-out failure log was called with the bound logger
      expect(mockLogFn).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('Failed to sign out of Tableau REST API'),
          level: 'warning',
          logger: 'auth',
        }),
      );
    });

    it('should use bound logger for request error interceptor with populated LUIDs', () => {
      const server = new WebMcpServer();
      const mockLogFn = vi.fn();
      const boundLogger = new Logger({
        getSiteLuid: () => 'test-site-luid',
        getUserLuid: () => 'test-user-luid',
      });
      boundLogger.log = mockLogFn;

      const errorInterceptor = getRequestErrorInterceptor(server, mockRequestId, boundLogger);
      const mockError = new Error('Non-Axios request error');

      errorInterceptor(mockError, mockHost);

      // Verify the bound logger was used
      expect(mockLogFn).toHaveBeenCalledWith({
        message: `Request ${mockRequestId} failed`,
        level: 'error',
        logger: 'rest-api',
        data: mockError,
      });
    });

    it('should use bound logger for response error interceptor with populated LUIDs', () => {
      const server = new WebMcpServer();
      const mockLogFn = vi.fn();
      const boundLogger = new Logger({
        getSiteLuid: () => 'test-site-luid',
        getUserLuid: () => 'test-user-luid',
      });
      boundLogger.log = mockLogFn;

      const errorInterceptor = getResponseErrorInterceptor(server, mockRequestId, boundLogger);
      const mockError = new Error('Non-Axios response error');

      errorInterceptor(mockError, mockHost);

      // Verify the bound logger was used
      expect(mockLogFn).toHaveBeenCalledWith({
        message: `Response from request ${mockRequestId} failed`,
        level: 'error',
        logger: 'rest-api',
        data: mockError,
      });
    });
  });
});
