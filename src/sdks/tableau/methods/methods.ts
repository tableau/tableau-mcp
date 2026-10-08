import { ZodiosClass, ZodiosEndpointDefinitions, ZodiosInstance } from '@zodios/core';

import { assertNoTraversal, pathParamGuardPlugin } from '../routeSafety.js';

export default class Methods<T extends ZodiosEndpointDefinitions> {
  protected _apiClient: ZodiosInstance<T>;

  constructor(apiClient: ZodiosInstance<T>) {
    this._apiClient = apiClient;
    // Route-safety guards: every endpoint of every client inherits them.
    apiClient.use(pathParamGuardPlugin);
    apiClient.axios.interceptors.request.use((c) => {
      assertNoTraversal(c.url ?? '');
      return c;
    });
  }

  get interceptors(): ZodiosClass<T>['axios']['interceptors'] {
    return this._apiClient.axios.interceptors;
  }
}
