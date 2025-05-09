import { log, shouldLogWhenLevelIsAtLeast } from './log.js';
import { AuthConfig } from './sdks/tableau/authConfig.js';
import RestApi, { RequestInterceptor, ResponseInterceptor } from './sdks/tableau/restApi.js';

const getRequestInterceptor =
  (requestId: string): RequestInterceptor =>
  (config) => {
    const urlParts = [...config.baseUrl.split('/'), ...config.url.split('/')].filter(Boolean);
    const messageObj = {
      type: 'request',
      requestId,
      method: config.method,
      url: urlParts.join('/'),
      ...(shouldLogWhenLevelIsAtLeast('debug') && {
        headers: config.headers,
        data: config.data,
      }),
    } as const;

    log.info(messageObj, 'rest-api');
    return config;
  };

const getResponseInterceptor =
  (requestId: string): ResponseInterceptor =>
  (response) => {
    const urlParts = [...response.baseUrl.split('/'), ...response.url.split('/')].filter(Boolean);
    const messageObj = {
      type: 'response',
      requestId,
      url: urlParts.join('/'),
      status: response.status,
      ...(shouldLogWhenLevelIsAtLeast('debug') && {
        headers: response.headers,
        data: response.data,
      }),
    } as const;

    log.info(messageObj, 'rest-api');
  };

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
