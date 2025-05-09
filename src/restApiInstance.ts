import { log } from './log.js';
import { AuthConfig } from './sdks/tableau/authConfig.js';
import RestApi from './sdks/tableau/restApi.js';

export const getNewInstanceAsync = async (
  host: string,
  authConfig: AuthConfig,
): Promise<RestApi> => {
  const restApi = new RestApi(host);
  for (const {
    interceptors: { request, response },
  } of restApi.methods) {
    request.use((config) => {
      const messageObj = {
        method: config.method,
        url: config.url,
        headers: config.headers,
        data: config.data,
        params: config.params,
      };

      log.debug(`Request: ${JSON.stringify(messageObj, null, 2)}`);
      return config;
    });

    response.use((response) => {
      const messageObj = {
        url: response.config.url,
        status: response.status,
        headers: response.headers,
        data: response.data,
        params: response.config.params,
      };

      log.debug(`Response: ${JSON.stringify(messageObj, null, 2)}`);
      return response;
    });
  }

  await restApi.signIn(authConfig);
  return restApi;
};
