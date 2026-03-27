import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getConfig } from './config.js';
import { log } from './logging/notification.js';
import {
  getRequestErrorInterceptor,
  getRequestInterceptor,
  getResponseErrorInterceptor,
  getResponseInterceptor,
  useRestApi,
} from './restApiInstance.js';
import { RestApi } from './sdks/tableau/restApi.js';
import { Server, userAgent } from './server.js';

vi.mock('./logging/notification.js', () => ({
  log: {
    info: vi.fn(),
    error: vi.fn(),
  },
  shouldLogWhenLevelIsAtLeast: vi.fn().mockReturnValue(true),
}));

describe('restApiInstance', () => {
  const mockHost = 'https://my-tableau-server.com';
  const mockRequestId = 'test-request-id';

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
        server: new Server(),
        tableauAuthInfo: undefined,
        jwtScopes: [],
        signal: new AbortController().signal,
        callback: (restApi) => Promise.resolve(restApi),
      });

      expect(RestApi).toHaveBeenCalledWith(mockHost, expect.any(Object));
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
        server: new Server(),
        tableauAuthInfo: undefined,
        jwtScopes: [],
        signal: new AbortController().signal,
        callback: (restApi) => Promise.resolve(restApi),
      });

      expect(RestApi).toHaveBeenCalledWith(mockHost, expect.any(Object));
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
        server: new Server(),
        tableauAuthInfo: undefined,
        jwtScopes: [],
        signal: new AbortController().signal,
        callback: (restApi) => Promise.resolve(restApi),
      });

      expect(RestApi).toHaveBeenCalledWith(mockHost, expect.any(Object));
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
        server: new Server(),
        tableauAuthInfo: {
          type: 'Bearer',
          username: 'test-user',
          server: 'https://my-tableau-server.com',
          siteId: 'site-luid',
          raw: 'abc123|xyz789|site-luid',
        },
        jwtScopes: [],
        signal: new AbortController().signal,
        callback: (restApi) => Promise.resolve(restApi),
      });

      expect(RestApi).toHaveBeenCalledWith(mockHost, expect.any(Object));
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
        server: new Server(),
        tableauAuthInfo: {
          type: 'X-Tableau-Auth',
          username: 'test-user',
          userId: 'user-luid-123',
          server: 'https://my-tableau-server.com',
          accessToken: 'abc123|xyz789|site-luid',
          refreshToken: 'refresh-token-123',
        },
        jwtScopes: [],
        signal: new AbortController().signal,
        callback: (restApi) => Promise.resolve(restApi),
      });

      expect(RestApi).toHaveBeenCalledWith(mockHost, expect.any(Object));
      expect(restApi.setCredentials).toHaveBeenCalledWith(
        'abc123|xyz789|site-luid',
        'user-luid-123',
      );
      expect(restApi.signIn).not.toHaveBeenCalled();
      expect(restApi.signOut).not.toHaveBeenCalled();
    });

    it('should set credentials when using Passthrough auth', async () => {
      vi.stubEnv('AUTH', 'pat');

      const restApi = await useRestApi({
        config: getConfig(),
        requestId: mockRequestId,
        server: new Server(),
        tableauAuthInfo: {
          type: 'Passthrough',
          username: 'test-user',
          userId: 'user-luid-123',
          server: 'https://my-tableau-server.com',
          siteId: 'site-luid',
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
      const server = new Server();
      const interceptor = getRequestInterceptor(server, mockRequestId);
      const mockRequest = {
        headers: {} as Record<string, string>,
        method: 'GET',
        url: '/api/test',
        baseUrl: mockHost,
      };

      interceptor(mockRequest);

      expect(mockRequest.headers['User-Agent']).toBe(userAgent);
      expect(log.info).toHaveBeenCalledWith(
        server,
        expect.objectContaining({
          type: 'request',
          requestId: mockRequestId,
          method: 'GET',
          url: expect.any(String),
        }),
        expect.objectContaining({
          logger: 'rest-api',
          requestId: mockRequestId,
        }),
      );
    });
  });

  describe('Response Interceptor', () => {
    it('should log response', () => {
      const server = new Server();
      const interceptor = getResponseInterceptor(server, mockRequestId);
      const mockResponse = {
        status: 200,
        url: '/api/test',
        baseUrl: mockHost,
        headers: {},
        data: {},
      };

      const result = interceptor(mockResponse);

      expect(result).toBe(mockResponse);
      expect(log.info).toHaveBeenCalledWith(
        server,
        expect.objectContaining({
          type: 'response',
          requestId: mockRequestId,
          status: 200,
          url: expect.any(String),
        }),
        expect.objectContaining({
          logger: 'rest-api',
          requestId: mockRequestId,
        }),
      );
    });
  });

  describe('Error Handling', () => {
    it('should handle request errors', () => {
      const server = new Server();
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

      expect(log.error).toHaveBeenCalledWith(
        server,
        `Request ${mockRequestId} failed with error: ${JSON.stringify(mockError)}`,
        expect.objectContaining({
          logger: 'rest-api',
          requestId: mockRequestId,
        }),
      );
    });

    it('should handle AxiosError request errors', () => {
      const server = new Server();
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

      expect(log.info).toHaveBeenCalled();

      expect(log.info).toHaveBeenCalledWith(
        server,
        expect.objectContaining({
          type: 'request',
          requestId: mockRequestId,
          method: 'GET',
          url: expect.any(String),
        }),
        expect.objectContaining({
          logger: 'rest-api',
          requestId: mockRequestId,
        }),
      );
    });

    it('should handle response errors', () => {
      const server = new Server();
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

      expect(log.error).toHaveBeenCalledWith(
        server,
        `Response from request ${mockRequestId} failed with error: ${JSON.stringify(mockError)}`,
        expect.objectContaining({
          logger: 'rest-api',
          requestId: mockRequestId,
        }),
      );
    });

    it('should handle AxiosError response errors', () => {
      const server = new Server();
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

      expect(log.info).toHaveBeenCalledWith(
        server,
        expect.objectContaining({
          type: 'response',
          requestId: mockRequestId,
          url: expect.any(String),
          status: 500,
        }),
        expect.objectContaining({
          logger: 'rest-api',
          requestId: mockRequestId,
        }),
      );
    });
  });
});
