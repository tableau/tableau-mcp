import { Zodios, ZodiosInstance } from '@zodios/core';

import { AxiosRequestConfig } from '../../utils/axios.js';
import { vizqlApis } from './apis.js';

export const getClient = (basePath: string, axiosConfig: AxiosRequestConfig): VizqlClient => {
  return new Zodios(basePath, vizqlApis, { axiosConfig });
};

export type VizqlClient = ZodiosInstance<typeof vizqlApis>;
