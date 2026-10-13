import { AxiosError } from 'axios';

import * as logger from '../logging/logger.js';
import { RouteSafetyError } from '../sdks/routeSafety/core.js';
import { AxiosRequestHeaders, AxiosResponse } from '../utils/axios.js';
import {
  getRequestErrorInterceptor,
  getRequestInterceptor,
  getResponseErrorInterceptor,
  getResponseInterceptor,
} from './getAgentApiClient.js';

vi.mock('../logging/logger.js');

describe('getAgentApiClient', () => {
  const mockHost = 'http://127.0.0.1:8765/api/v1';

  describe('Request Interceptor', () => {
    it('should log request', () => {
      const interceptor = getRequestInterceptor();
      const mockRequest = {
        headers: {} as Record<string, string>,
        method: 'GET',
        url: '/api/commands',
        baseUrl: mockHost,
      };

      interceptor(mockRequest);

      expect(logger.log).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Agent API request',
          level: 'debug',
          logger: 'AgentApiClient',
          data: expect.objectContaining({
            method: 'GET',
            url: 'http://127.0.0.1:8765/api/v1/api/commands',
            headers: {},
            data: undefined,
          }),
        }),
      );
    });
  });

  describe('Response Interceptor', () => {
    it('should log response', () => {
      const interceptor = getResponseInterceptor();
      const mockResponse = {
        status: 200,
        url: '/api/commands',
        baseUrl: mockHost,
        params: {},
        headers: {},
        data: {},
      };

      const result = interceptor(mockResponse);

      expect(result).toBe(mockResponse);
      expect(logger.log).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Agent API response',
          level: 'debug',
          logger: 'AgentApiClient',
          data: expect.objectContaining({
            status: 200,
            url: 'http://127.0.0.1:8765/api/v1/api/commands',
            headers: {},
            data: {},
          }),
        }),
      );
    });
  });

  describe('Error Handling', () => {
    it.each([
      ['request', getRequestErrorInterceptor],
      ['response', getResponseErrorInterceptor],
    ])(
      'logs a RouteSafetyError from the %s error interceptor as a warning, not an error',
      (_kind, getInterceptor) => {
        vi.mocked(logger.log).mockClear();
        const errorInterceptor = getInterceptor();
        const error = new RouteSafetyError(
          "Path parameter 'commandId' is not a valid route segment",
        );

        errorInterceptor(error, mockHost);

        expect(logger.log).toHaveBeenCalledTimes(1);
        expect(logger.log).toHaveBeenCalledWith(
          expect.objectContaining({ level: 'warning', logger: 'AgentApiClient' }),
        );
        expect(vi.mocked(logger.log).mock.calls[0][0]).not.toHaveProperty('data');
      },
    );

    it('should handle request errors', () => {
      const errorInterceptor = getRequestErrorInterceptor();
      const error = new Error('Request failed');

      errorInterceptor(error, mockHost);

      expect(logger.log).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Request failed',
          level: 'error',
          logger: 'AgentApiClient',
          data: error,
        }),
      );
    });

    it('should handle AxiosError request errors', () => {
      const errorInterceptor = getRequestErrorInterceptor();
      const mockRequest = {
        headers: {} as Record<string, string>,
        method: 'GET',
        url: '/api/commands',
        baseUrl: mockHost,
      };
      const mockError = new AxiosError('Request failed', 'ERR_NETWORK', undefined, mockRequest);

      errorInterceptor(mockError, mockHost);

      expect(logger.log).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Agent API request',
          level: 'debug',
          logger: 'AgentApiClient',
          data: expect.objectContaining({
            method: 'GET',
            url: 'http://127.0.0.1:8765/api/v1/api/commands',
            headers: {},
            data: undefined,
          }),
        }),
      );
    });

    it('should handle response errors', () => {
      const errorInterceptor = getResponseErrorInterceptor();
      const error = new Error('Request failed');

      errorInterceptor(error, mockHost);

      expect(logger.log).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Response failed',
          level: 'error',
          logger: 'AgentApiClient',
          data: error,
        }),
      );
    });

    it('should handle AxiosError response errors', () => {
      const errorInterceptor = getResponseErrorInterceptor();
      const mockRequest = {
        headers: {} as Record<string, string>,
        method: 'GET',
        url: '/api/commands',
        baseUrl: mockHost,
      };

      const mockResponse: AxiosResponse = {
        data: { error: 'Unauthorized' },
        status: 401,
        statusText: 'Unauthorized',
        headers: {},
        config: {
          method: 'GET',
          url: '/api/commands',
          headers: {} as AxiosRequestHeaders,
        },
      };

      const mockError = new AxiosError(
        'Request failed with status code 401',
        'ERR_BAD_REQUEST',
        { headers: {} as AxiosRequestHeaders },
        mockRequest,
        mockResponse,
      );

      errorInterceptor(mockError, mockHost);

      expect(logger.log).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Agent API response',
          level: 'debug',
          logger: 'AgentApiClient',
          data: expect.objectContaining({
            status: 401,
            url: 'http://127.0.0.1:8765/api/v1/api/commands',
            headers: {},
            data: { error: 'Unauthorized' },
          }),
        }),
      );
    });
  });
});
