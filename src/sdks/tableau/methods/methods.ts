import { ZodiosClass, ZodiosEndpointDefinitions, ZodiosInstance } from '@zodios/core';

import { installRouteGuards } from '../../routeSafety/zodios.js';

export default class Methods<T extends ZodiosEndpointDefinitions> {
  protected _apiClient: ZodiosInstance<T>;

  constructor(apiClient: ZodiosInstance<T>) {
    this._apiClient = apiClient;
    // Route-safety guards: every endpoint of every client inherits them.
    installRouteGuards(apiClient);
  }

  get interceptors(): ZodiosClass<T>['axios']['interceptors'] {
    return this._apiClient.axios.interceptors;
  }
}
