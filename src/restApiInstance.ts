import { log } from './log.js';
import { AuthConfig } from './sdks/tableau/authConfig.js';
import RestApi, { RequestInterceptor, ResponseInterceptor } from './sdks/tableau/restApi.js';

const requestInterceptor: RequestInterceptor = (config) => {
  const messageObj = {
    method: config.method,
    url: config.url,
    headers: config.headers,
    data: config.data,
  };

  log.debug(`Request: ${JSON.stringify(messageObj, null, 2)}`);
  return config;
};

const responseInterceptor: ResponseInterceptor = (response) => {
  const messageObj = {
    url: response.url,
    status: response.status,
    headers: response.headers,
    data: response.data,
  };

  log.debug(`Response: ${JSON.stringify(messageObj, null, 2)}`);
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
