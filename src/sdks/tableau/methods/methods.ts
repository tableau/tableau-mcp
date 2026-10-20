import { ZodiosClass, ZodiosEndpointDefinitions, ZodiosInstance } from '@zodios/core';

import { installRouteGuards } from '../../routeSafety/zodios.js';

export default class Methods<T extends ZodiosEndpointDefinitions> {
  protected _apiClient: ZodiosInstance<T>;

  constructor(apiClient: ZodiosInstance<T>) {
    this._apiClient = apiClient;
    // Route-safety guards. Clients built with `createGuardedZodios` already carry them (a no-op
    // here); this is the backstop for a client constructed some other way, e.g. a test double.
    installRouteGuards(apiClient);
  }

  get interceptors(): ZodiosClass<T>['axios']['interceptors'] {
    return this._apiClient.axios.interceptors;
  }
}
