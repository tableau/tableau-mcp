import { Zodios, ZodiosInstance } from '@zodios/core';

import { tableauTokenApi } from './apis.js';

export const getClient = (basePath: string): ZodiosInstance<typeof tableauTokenApi> => {
  return new Zodios(basePath, tableauTokenApi);
};
