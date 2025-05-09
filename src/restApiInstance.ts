import { AuthConfig } from './sdks/tableau/authConfig.js';
import { getRequestInterceptor, getResponseInterceptor } from './sdks/tableau/interceptors.js';
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
