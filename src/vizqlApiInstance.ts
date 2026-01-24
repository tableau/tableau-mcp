import { RequestId } from '@modelcontextprotocol/sdk/types.js';

import {
  addInterceptors,
  getRequestErrorInterceptor,
  getRequestInterceptor,
  getResponseErrorInterceptor,
  getResponseInterceptor,
} from './apiClients.js';
import { Config } from './config.js';
import { log } from './logging/log.js';
import { getClient, VizqlClient } from './sdks/tableau-vizql/client.js';
import { Server } from './server.js';
import { TableauAuthInfo } from './server/oauth/schemas.js';
import { AxiosRequestConfig } from './utils/axios.js';

export const getNewVizqlApiInstanceAsync = async (
  config: Config,
  requestId: RequestId,
  server: Server,
  signal: AbortSignal,
  axiosConfig: AxiosRequestConfig,
  authInfo?: TableauAuthInfo,
): Promise<VizqlClient> => {
  signal.addEventListener(
    'abort',
    () => {
      log.info(
        server,
        {
          type: 'request-cancelled',
          requestId,
          reason: signal.reason,
        },
        { logger: server.name, requestId },
      );
    },
    { once: true },
  );

  const baseUrl = (config.server || authInfo?.server) ?? '';
  const client = getClient(baseUrl, axiosConfig);

  addInterceptors(
    baseUrl,
    client.axios.interceptors,
    [
      getRequestInterceptor(server, requestId, 'vizql-api'),
      getRequestErrorInterceptor(server, requestId, 'vizql-api'),
    ],
    [
      getResponseInterceptor(server, requestId, 'vizql-api'),
      getResponseErrorInterceptor(server, requestId, 'vizql-api'),
    ],
  );

  return client;
};
