import { config } from './config.js';
import { log, shouldLogWhenLevelIsAtLeast } from './logging/log.js';
import { maskRequest, maskResponse } from './logging/secretMask.js';
import { AuthConfig } from './sdks/tableau/authConfig.js';
import { RequestInterceptor, ResponseInterceptor } from './sdks/tableau/interceptors.js';
import RestApi from './sdks/tableau/restApi.js';

export const getNewRestApiInstanceAsync = async (
  host: string,
  authConfig: AuthConfig,
  requestId: string,
): Promise<RestApi> => {
  const restApi = new RestApi(host, {
    requestInterceptor: getRequestInterceptor(requestId),
    responseInterceptor: getResponseInterceptor(requestId),
  });

  await restApi.signIn(authConfig);
  return restApi;
};

export const getRequestInterceptor =
  (requestId: string): RequestInterceptor =>
  (request) => {
    const maskedRequest = config.disableLogMasking ? request : maskRequest(request);
    const { baseUrl, url } = maskedRequest;
    const urlParts = [...baseUrl.split('/'), ...url.split('/')].filter(Boolean);
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
    return request;
  };

export const getResponseInterceptor =
  (requestId: string): ResponseInterceptor =>
  (response) => {
    const maskedResponse = config.disableLogMasking ? response : maskResponse(response);
    const { baseUrl, url } = maskedResponse;
    const urlParts = [...baseUrl.split('/'), ...url.split('/')].filter(Boolean);
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
  };
