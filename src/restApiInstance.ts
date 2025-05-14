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

export const getNewRestApiInstanceAsync = async (
  host: string,
  authConfig: AuthConfig,
  requestId: string,
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
  (requestId: string): RequestInterceptor =>
  (request) => {
    request.headers['User-Agent'] = `${server.name}/${server.version}`;
    logRequest(request, requestId);
    return request;
  };

export const getRequestErrorInterceptor =
  (requestId: string): ErrorInterceptor =>
  (error, baseUrl) => {
    if (!isAxiosError(error) || !error.request) {
      const message = error instanceof Error ? error.message : `${error}`;
      log.error(`Request ${requestId} failed with error: ${message}`, 'rest-api');
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
  (requestId: string): ResponseInterceptor =>
  (response) => {
    logResponse(response, requestId);
    return response;
  };

export const getResponseErrorInterceptor =
  (requestId: string): ErrorInterceptor =>
  (error, baseUrl) => {
    if (!isAxiosError(error) || !error.response) {
      const message = error instanceof Error ? error.message : `${error}`;
      log.error(`Response from request ${requestId} failed with error: ${message}`, 'rest-api');
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

function logRequest(request: RequestInterceptorConfig, requestId: string): void {
  const config = getConfig();
  const maskedRequest = config.disableLogMasking ? request : maskRequest(request);
  const { baseUrl, url } = maskedRequest;
  const urlParts = [...baseUrl.split('/'), ...(url?.split('/') ?? [])].filter(Boolean);
  const messageObj = {
    type: 'request',
    requestId,
    method: maskedRequest.method,
    url: urlParts.join('/'),
    ...(shouldLogWhenLevelIsAtLeast('debug') && {
      headers: maskedRequest.headers,
      data: maskedRequest.data,
    }),
  } as const;

  log.info(messageObj, 'rest-api');
}

function logResponse(response: ResponseInterceptorConfig, requestId: string): void {
  const config = getConfig();
  const maskedResponse = config.disableLogMasking ? response : maskResponse(response);
  const { baseUrl, url } = maskedResponse;
  const urlParts = [...baseUrl.split('/'), ...(url?.split('/') ?? [])].filter(Boolean);
  const messageObj = {
    type: 'response',
    requestId,
    url: urlParts.join('/'),
    status: maskedResponse.status,
    ...(shouldLogWhenLevelIsAtLeast('debug') && {
      headers: maskedResponse.headers,
      data: maskedResponse.data,
    }),
  } as const;

  log.info(messageObj, 'rest-api');
}
