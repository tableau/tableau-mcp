import { RequestId } from '@modelcontextprotocol/sdk/types.js';

import { getConfig } from './config.js';
import { log, shouldLogWhenLevelIsAtLeast } from './logging/log.js';
import { maskRequest, maskResponse } from './logging/secretMask.js';
import {
  AxiosInterceptor,
  AxiosResponseInterceptorConfig,
  ErrorInterceptor,
  getRequestInterceptorConfig,
  getResponseInterceptorConfig,
  RequestInterceptor,
  RequestInterceptorConfig,
  ResponseInterceptor,
  ResponseInterceptorConfig,
} from './sdks/tableau/interceptors.js';
import { Server, userAgent } from './server.js';
import { isAxiosError } from './utils/axios.js';
import { getExceptionMessage } from './utils/getExceptionMessage.js';

export const getRequestInterceptor =
  (server: Server, requestId: RequestId, logger: string): RequestInterceptor =>
  (request) => {
    request.headers['User-Agent'] = getUserAgent(server);
    logRequest(server, request, requestId, logger);
    return request;
  };

export const getRequestErrorInterceptor =
  (server: Server, requestId: RequestId, logger: string): ErrorInterceptor =>
  (error, baseUrl) => {
    if (!isAxiosError(error) || !error.request) {
      log.error(server, `Request ${requestId} failed with error: ${getExceptionMessage(error)}`, {
        logger,
        requestId,
      });
      return;
    }

    const { request } = error;
    logRequest(
      server,
      {
        baseUrl,
        ...getRequestInterceptorConfig(request),
      },
      requestId,
      logger,
    );
  };

export const getResponseInterceptor =
  (server: Server, requestId: RequestId, logger: string): ResponseInterceptor =>
  (response) => {
    logResponse(server, response, requestId, logger);
    return response;
  };

export const getResponseErrorInterceptor =
  (server: Server, requestId: RequestId, logger: string): ErrorInterceptor =>
  (error, baseUrl) => {
    if (!isAxiosError(error) || !error.response) {
      log.error(
        server,
        `Response from request ${requestId} failed with error: ${getExceptionMessage(error)}`,
        { logger, requestId },
      );
      return;
    }

    // The type for the AxiosResponse headers is complex and not directly assignable to that of the Axios response interceptor's.
    const { response } = error as { response: AxiosResponseInterceptorConfig };
    logResponse(
      server,
      {
        baseUrl,
        ...getResponseInterceptorConfig(response),
      },
      requestId,
      logger,
    );
  };

function logRequest(
  server: Server,
  request: RequestInterceptorConfig,
  requestId: RequestId,
  logger: string,
): void {
  const config = getConfig();
  const maskedRequest = config.disableLogMasking ? request : maskRequest(request);
  const url = new URL(
    `${maskedRequest.baseUrl.replace(/\/$/, '')}/${maskedRequest.url?.replace(/^\//, '') ?? ''}`,
  );
  if (request.params && Object.keys(request.params).length > 0) {
    url.search = new URLSearchParams(request.params).toString();
  }

  const messageObj = {
    type: 'request',
    requestId,
    method: maskedRequest.method,
    url: url.toString(),
    ...(shouldLogWhenLevelIsAtLeast('debug') && {
      headers: maskedRequest.headers,
      data: maskedRequest.data,
      params: maskedRequest.params,
    }),
  } as const;

  log.info(server, messageObj, { logger, requestId });
}

function logResponse(
  server: Server,
  response: ResponseInterceptorConfig,
  requestId: RequestId,
  logger: string,
): void {
  const config = getConfig();
  const maskedResponse = config.disableLogMasking ? response : maskResponse(response);
  const url = new URL(
    `${maskedResponse.baseUrl.replace(/\/$/, '')}/${maskedResponse.url?.replace(/^\//, '') ?? ''}`,
  );
  if (response.request?.params && Object.keys(response.request.params).length > 0) {
    url.search = new URLSearchParams(response.request.params).toString();
  }
  const messageObj = {
    type: 'response',
    requestId,
    url: url.toString(),
    status: maskedResponse.status,
    ...(shouldLogWhenLevelIsAtLeast('debug') && {
      headers: maskedResponse.headers,
      data: maskedResponse.data,
    }),
  } as const;

  log.info(server, messageObj, { logger, requestId });
}

function getUserAgent(server: Server): string {
  const userAgentParts = [userAgent];
  if (server.clientInfo) {
    const { name, version } = server.clientInfo;
    if (name) {
      userAgentParts.push(version ? `(${name} ${version})` : `(${name})`);
    }
  }
  return userAgentParts.join(' ');
}

export const addInterceptors = (
  baseUrl: string,
  axiosInterceptors: AxiosInterceptor,
  requestInterceptors?: [RequestInterceptor, ErrorInterceptor?],
  responseInterceptors?: [ResponseInterceptor, ErrorInterceptor?],
): void => {
  axiosInterceptors.request.use(
    (config) => {
      requestInterceptors?.[0]({
        baseUrl,
        ...getRequestInterceptorConfig(config),
      });
      return config;
    },
    (error) => {
      requestInterceptors?.[1]?.(error, baseUrl);
      return Promise.reject(error);
    },
  );

  axiosInterceptors.response.use(
    (response) => {
      responseInterceptors?.[0]({
        baseUrl,
        ...getResponseInterceptorConfig(response),
      });
      return response;
    },
    (error) => {
      responseInterceptors?.[1]?.(error, baseUrl);
      return Promise.reject(error);
    },
  );
};
