import { ZodiosClass, ZodiosEndpointDefinitions, ZodiosInstance } from '@zodios/core';

export default class Methods<T extends ZodiosEndpointDefinitions> {
  protected _apiClient: ZodiosInstance<T>;

  constructor(apiClient: ZodiosInstance<T>) {
    this._apiClient = apiClient;
  }

  get interceptors(): ZodiosClass<T>['axios']['interceptors'] {
    return this._apiClient.axios.interceptors;
  }
}
