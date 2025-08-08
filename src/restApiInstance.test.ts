import { beforeEach, describe, expect, it, vi } from 'vitest';

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

      expect(mockRequest.headers['User-Agent']).toBe(`${server.name}/${server.version}`);
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
