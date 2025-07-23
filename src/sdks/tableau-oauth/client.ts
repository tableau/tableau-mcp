import { Zodios, ZodiosInstance } from '@zodios/core';

import { userAgent } from '../../server/userAgent.js';
import { tableauTokenApi } from './apis.js';

export const getClient = (basePath: string): ZodiosInstance<typeof tableauTokenApi> => {
  const client = new Zodios(basePath, tableauTokenApi);
  client.axios.interceptors.request.use((config) => {
    config.headers['Content-Type'] = 'application/x-www-form-urlencoded';
    config.headers['User-Agent'] = userAgent;
    return config;
  });

  return client;
};
