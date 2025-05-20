import { beforeEach, describe, expect, it, vi } from 'vitest';

import { log } from './logging/log.js';
import {
  getNewRestApiInstanceAsync,
  getRequestErrorInterceptor,
  getRequestInterceptor,
  getResponseErrorInterceptor,
  getResponseInterceptor,
} from './restApiInstance.js';
import { AuthConfig } from './sdks/tableau/authConfig.js';
import RestApi from './sdks/tableau/restApi.js';
import { server } from './server.js';

vi.mock('./sdks/tableau/restApi.js', () => ({
  default: vi.fn().mockImplementation(() => ({
    signIn: vi.fn().mockResolvedValue(undefined),
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
  const mockHost = 'https://test.tableau.com';
  const mockAuthConfig: AuthConfig = {
    type: 'pat',
    patName: 'test-token',
    patValue: 'test-secret',
    siteName: 'test-site',
  };
  const mockRequestId = 'test-request-id';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getNewRestApiInstanceAsync', () => {
    it('should create a new RestApi instance and sign in', async () => {
      const restApi = await getNewRestApiInstanceAsync(mockHost, mockAuthConfig, mockRequestId);

      expect(RestApi).toHaveBeenCalledWith(mockHost, expect.any(Object));
      expect(restApi.signIn).toHaveBeenCalledWith(mockAuthConfig);
    });
  });

  describe('Request Interceptor', () => {
    it('should add User-Agent header and log request', () => {
      const interceptor = getRequestInterceptor(mockRequestId);
      const mockRequest = {
        headers: {} as Record<string, string>,
        method: 'GET',
        url: '/api/test',
        baseUrl: mockHost,
      };

      interceptor(mockRequest);

      expect(mockRequest.headers['User-Agent']).toBe(`${server.name}/${server.version}`);
      expect(log.info).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'request',
          requestId: mockRequestId,
          method: 'GET',
          url: expect.any(String),
        }),
        'rest-api',
      );
    });
  });

  describe('Response Interceptor', () => {
    it('should log response', () => {
      const interceptor = getResponseInterceptor(mockRequestId);
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
        expect.objectContaining({
          type: 'response',
          requestId: mockRequestId,
          status: 200,
          url: expect.any(String),
        }),
        'rest-api',
      );
    });
  });

  describe('Error Handling', () => {
    it('should handle request errors', () => {
      const errorInterceptor = getRequestErrorInterceptor(mockRequestId);
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
        `Request ${mockRequestId} failed with error: ${JSON.stringify(mockError)}`,
        'rest-api',
      );
    });

    it('should handle AxiosError request errors', () => {
      const errorInterceptor = getRequestErrorInterceptor(mockRequestId);
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
        expect.objectContaining({
          type: 'request',
          requestId: mockRequestId,
          method: 'GET',
          url: expect.any(String),
        }),
        'rest-api',
      );
    });

    it('should handle response errors', () => {
      const errorInterceptor = getResponseErrorInterceptor(mockRequestId);
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
        `Response from request ${mockRequestId} failed with error: ${JSON.stringify(mockError)}`,
        'rest-api',
      );
    });

    it('should handle AxiosError response errors', () => {
      const errorInterceptor = getResponseErrorInterceptor(mockRequestId);
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
        expect.objectContaining({
          type: 'response',
          requestId: mockRequestId,
          url: expect.any(String),
          status: 500,
        }),
        'rest-api',
      );
    });
  });
});
