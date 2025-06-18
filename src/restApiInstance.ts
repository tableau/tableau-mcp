import { RequestId } from '@modelcontextprotocol/sdk/types.js';

import { isAxiosError } from '../node_modules/axios/index.js';
import { getConfig } from './config.js';
import { log, shouldLogWhenLevelIsAtLeast } from './logging/log.js';
import { maskRequest, maskResponse } from './logging/secretMask.js';
import { AuthConfig } from './sdks/tableau/authConfig.js';
import {
  AxiosResponseInterceptorConfig,
  ErrorInterceptor,
  getRequestInterceptorConfig,
  getResponseInterceptorConfig,
  RequestInterceptor,
  RequestInterceptorConfig,
  ResponseInterceptor,
  ResponseInterceptorConfig,
} from './sdks/tableau/interceptors.js';
import RestApi from './sdks/tableau/restApi.js';
import { server } from './server.js';
import { getExceptionMessage } from './utils/getExceptionMessage.js';

export const getNewRestApiInstanceAsync = async (
  host: string,
  authConfig: AuthConfig,
  requestId: RequestId,
): Promise<RestApi> => {
  const restApi = new RestApi(host, {
    requestInterceptor: [getRequestInterceptor(requestId), getRequestErrorInterceptor(requestId)],
    responseInterceptor: [
      getResponseInterceptor(requestId),
      getResponseErrorInterceptor(requestId),
    ],
  });

  await restApi.signIn(authConfig);
  return restApi;
};

export const getRequestInterceptor =
  (requestId: RequestId): RequestInterceptor =>
  (request) => {
    request.headers['User-Agent'] = `${server.name}/${server.version}`;
    logRequest(request, requestId);
    return request;
  };

export const getRequestErrorInterceptor =
  (requestId: RequestId): ErrorInterceptor =>
  (error, baseUrl) => {
    if (!isAxiosError(error) || !error.request) {
      log.error(
        `Request ${requestId} failed with error: ${getExceptionMessage(error)}`,
        'rest-api',
      );
      return;
    }

    const { request } = error;
    logRequest(
      {
        baseUrl,
        ...getRequestInterceptorConfig(request),
      },
      requestId,
    );
  };

export const getResponseInterceptor =
  (requestId: RequestId): ResponseInterceptor =>
  (response) => {
    logResponse(response, requestId);
    return response;
  };

export const getResponseErrorInterceptor =
  (requestId: RequestId): ErrorInterceptor =>
  (error, baseUrl) => {
    if (!isAxiosError(error) || !error.response) {
      log.error(
        `Response from request ${requestId} failed with error: ${getExceptionMessage(error)}`,
        'rest-api',
      );
      return;
    }

    // The type for the AxiosResponse headers is complex and not directly assignable to that of the Axios response interceptor's.
    const { response } = error as { response: AxiosResponseInterceptorConfig };
    logResponse(
      {
        baseUrl,
        ...getResponseInterceptorConfig(response),
      },
      requestId,
    );
  };

function logRequest(request: RequestInterceptorConfig, requestId: RequestId): void {
  const config = getConfig();
  const maskedRequest = config.disableLogMasking ? request : maskRequest(request);
  const url = new URL(maskedRequest.url ?? '', maskedRequest.baseUrl);
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

  log.info(messageObj, 'rest-api');
}

function logResponse(response: ResponseInterceptorConfig, requestId: RequestId): void {
  const config = getConfig();
  const maskedResponse = config.disableLogMasking ? response : maskResponse(response);
  const url = new URL(maskedResponse.url ?? '', maskedResponse.baseUrl);
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

  log.info(messageObj, 'rest-api');
}
