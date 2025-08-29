import { beforeEach, describe, expect, it, Mock, vi } from 'vitest';

import { getConfig } from './config.js';
import { log } from './logging/log.js';
import {
  getRequestErrorInterceptor,
  getRequestInterceptor,
  getResponseErrorInterceptor,
  getResponseInterceptor,
  useRestApi,
} from './restApiInstance.js';
import { AuthConfig } from './sdks/tableau/authConfig.js';
import RestApi from './sdks/tableau/restApi.js';
import { Server } from './server.js';
import { userAgent } from './server/userAgent.js';

vi.mock('./sdks/tableau/restApi.js', () => ({
  default: vi.fn().mockImplementation(() => ({
    signIn: vi.fn().mockResolvedValue(undefined),
    signOut: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('./logging/log.js', () => ({
  log: {
    info: vi.fn(),
    error: vi.fn(),
  },
  shouldLogWhenLevelIsAtLeast: vi.fn().mockReturnValue(true),
}));

describe('restApiInstance', () => {
  const mockHost = 'https://my-tableau-server.com';
  const mockAuthConfig: AuthConfig = {
    type: 'pat',
    patName: 'sponge',
    patValue: 'bob',
    siteName: 'tc25',
  };
  const mockRequestId = 'test-request-id';
  const mockConfig = getConfig();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('useRestApi', () => {
    it('should create a new RestApi instance and sign in', async () => {
      const restApi = await useRestApi({
        config: mockConfig,
        requestId: mockRequestId,
        server: new Server(),
        jwtScopes: [],
        context: 'none',
        callback: (restApi) => Promise.resolve(restApi),
      });

      expect(RestApi).toHaveBeenCalledWith(mockHost, expect.any(Object));
      expect(restApi.signIn).toHaveBeenCalledWith(mockAuthConfig);
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

  describe('JWT auth', () => {
    const fetchJsonResolve = vi.fn();

    const mockJwtProviderResponses = vi.hoisted(() => ({
      success: {
        jwt: 'mock-jwt',
      },
      error: {
        token: 'mock-jwt',
      },
    }));

    const mocks = vi.hoisted(() => ({
      mockJwtProviderResponse: vi.fn(),
    }));

    beforeEach(() => {
      vi.spyOn(global, 'fetch').mockImplementation(
        vi.fn(async () =>
          Promise.resolve({
            json: async () => {
              const json = await mocks.mockJwtProviderResponse();
              fetchJsonResolve(json);
              return Promise.resolve(json);
            },
          }),
        ) as Mock,
      );
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should create a new RestApi instance and sign in', async () => {
      mocks.mockJwtProviderResponse.mockResolvedValue(mockJwtProviderResponses.success);

      const config = getConfig();
      config.auth = 'jwt';
      config.jwtProviderUrl = 'https://example.com/jwt';
      config.jwtSubClaim = 'user@example.com';

      await useRestApi({
        config,
        requestId: mockRequestId,
        server: new Server(),
        jwtScopes: ['tableau:content:read'],
        context: 'query-datasource',
        callback: (restApi) => Promise.resolve(restApi),
      });

      expect(fetch).toHaveBeenCalledWith(config.jwtProviderUrl, {
        method: 'POST',
        body: JSON.stringify({
          username: config.jwtSubClaim,
          scopes: ['tableau:content:read'],
          source: 'test-server',
          resource: 'query-datasource',
          server: 'https://my-tableau-server.com',
          siteName: 'tc25',
        }),
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
      });
      expect(fetchJsonResolve).toHaveBeenCalledWith(mockJwtProviderResponses.success);
    });

    it('should throw an error if the JWT provider returns an invalid response', async () => {
      mocks.mockJwtProviderResponse.mockResolvedValue(mockJwtProviderResponses.error);

      const config = getConfig();
      config.auth = 'jwt';
      config.jwtProviderUrl = 'https://example.com/jwt';
      config.jwtSubClaim = 'user@example.com';

      await expect(
        useRestApi({
          config,
          requestId: mockRequestId,
          server: new Server(),
          jwtScopes: ['tableau:content:read'],
          context: 'query-datasource',
          callback: (restApi) => Promise.resolve(restApi),
        }),
      ).rejects.toThrow('Invalid JWT response, expected: { "jwt": "..." }');
    });
  });
});
