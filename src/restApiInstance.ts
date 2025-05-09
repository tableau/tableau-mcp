import { getCurrentLogLevel, log, shouldLogWhenLevelIsAtLeast } from './log.js';
import { AuthConfig } from './sdks/tableau/authConfig.js';
import RestApi, { RequestInterceptor, ResponseInterceptor } from './sdks/tableau/restApi.js';

const requestInterceptor: RequestInterceptor = (config) => {
  const parts = [...config.baseUrl.split('/'), ...config.url.split('/')].filter(Boolean);
  const messageObj = {
    type: 'request',
    currentLogLevel: getCurrentLogLevel(),
    method: config.method,
    url: parts.join('/'),
    ...(shouldLogWhenLevelIsAtLeast('debug') && {
      headers: config.headers,
      data: config.data,
    }),
  } as const;

  log.info(messageObj, 'rest-api');
  return config;
};

const responseInterceptor: ResponseInterceptor = (response) => {
  const parts = [...response.baseUrl.split('/'), ...response.url.split('/')].filter(Boolean);
  const messageObj = {
    type: 'response',
    currentLogLevel: getCurrentLogLevel(),
    url: parts.join('/'),
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
): Promise<RestApi> => {
  const restApi = new RestApi(host, {
    requestInterceptor,
    responseInterceptor,
  });

  await restApi.signIn(authConfig);
  return restApi;
};
