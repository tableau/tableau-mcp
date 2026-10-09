import { ZodiosInstance } from '@zodios/core';

import { AxiosRequestConfig } from '../../utils/axios.js';
import { createGuardedZodios } from '../routeSafety/zodios.js';
import { tableauTokenApi } from './apis.js';

export const getClient = (
  basePath: string,
  axiosConfig: AxiosRequestConfig,
): ZodiosInstance<typeof tableauTokenApi> => {
  return createGuardedZodios(basePath, tableauTokenApi, { axiosConfig });
};
