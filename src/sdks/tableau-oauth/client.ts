import { Zodios, ZodiosInstance } from '@zodios/core';

import { AxiosRequestConfig } from '../../utils/axios.js';
import { tableauTokenApi } from './apis.js';

export const getClient = (
  basePath: string,
  axiosConfig: AxiosRequestConfig,
): ZodiosInstance<typeof tableauTokenApi> => {
  return new Zodios(basePath, tableauTokenApi, { axiosConfig });
};
