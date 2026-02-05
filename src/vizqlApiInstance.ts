import { RequestId } from '@modelcontextprotocol/sdk/types.js';

import {
  addInterceptors,
  getRequestErrorInterceptor,
  getRequestInterceptor,
  getResponseErrorInterceptor,
  getResponseInterceptor,
} from './apiClients.js';
import { log } from './logging/log.js';
import { getClient, VizqlClient } from './sdks/tableau-vizql/client.js';
import { Server } from './server.js';

export const getNewVizqlApiInstanceAsync = async ({
  baseUrl,
  requestId,
  server,
  maxRequestTimeoutMs,
  signal,
}: {
  baseUrl: string;
  requestId: RequestId;
  server: Server;
  maxRequestTimeoutMs: number;
  signal: AbortSignal;
}): Promise<VizqlClient> => {
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

  const client = getClient(baseUrl, {
    timeout: maxRequestTimeoutMs,
    signal,
  });

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
