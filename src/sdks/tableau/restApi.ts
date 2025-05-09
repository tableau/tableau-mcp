import { ZodiosClass } from '@zodios/core';

import { AuthConfig } from './authConfig.js';
import AuthenticationMethods from './methods/authenticationMethods.js';
import MetadataMethods from './methods/metadataMethods.js';
import VizqlDataServiceMethods from './methods/vizqlDataServiceMethods.js';

export type RequestInterceptor = (config: {
  method: string;
  url: string;
  headers: Record<string, string>;
  data: any;
}) => void;

export type ResponseInterceptor = (response: {
  url: string;
  status: number;
  headers: Record<string, any>;
  data: any;
}) => void;

/**
 * Interface for the Tableau REST APIs
 *
 * @export
 * @class RestApi
 */
export default class RestApi {
  private _token?: string;
  private readonly _host: string;
  private readonly _baseUrl: string;

  private _metadataMethods?: MetadataMethods;
  private _vizqlDataServiceMethods?: VizqlDataServiceMethods;

  private static _version = '3.24';

  private _requestInterceptor?: RequestInterceptor;
  private _responseInterceptor?: ResponseInterceptor;

  constructor(
    host: string,
    options?: Partial<{
      requestInterceptor: RequestInterceptor;
      responseInterceptor: ResponseInterceptor;
    }>,
  ) {
    this._host = host;
    this._baseUrl = `${this._host}/api/${RestApi._version}`;
    this._requestInterceptor = options?.requestInterceptor;
    this._responseInterceptor = options?.responseInterceptor;
  }

  get token(): string {
    if (!this._token) {
      throw new Error('No token found. Authenticate by calling signIn() first.');
    }

    return this._token;
  }

  get metadataMethods(): MetadataMethods {
    if (!this._metadataMethods) {
      this._metadataMethods = new MetadataMethods(`${this._host}/api/metadata`, this.token);
      this._addInterceptors(this._metadataMethods.interceptors);
    }

    return this._metadataMethods;
  }

  get vizqlDataServiceMethods(): VizqlDataServiceMethods {
    if (!this._vizqlDataServiceMethods) {
      this._vizqlDataServiceMethods = new VizqlDataServiceMethods(
        `${this._host}/api/v1/vizql-data-service`,
        this.token,
      );
      this._addInterceptors(this._vizqlDataServiceMethods.interceptors);
    }

    return this._vizqlDataServiceMethods;
  }

  get methods(): (MetadataMethods | VizqlDataServiceMethods)[] {
    return [this.metadataMethods, this.vizqlDataServiceMethods];
  }

  signIn = async (authConfig: AuthConfig): Promise<void> => {
    const authenticationMethods = new AuthenticationMethods(this._baseUrl);
    this._token = (await authenticationMethods.signIn(authConfig)).token;
  };

  private _addInterceptors = (interceptors: ZodiosClass<any>['axios']['interceptors']): void => {
    interceptors.request.use((config) => {
      this._requestInterceptor?.({
        method: config.method ?? 'UNKNOWN METHOD',
        url: config.url ?? 'UNKNOWN URL',
        headers: config.headers,
        data: config.data,
      });
      return config;
    });

    interceptors.response.use((response) => {
      this._responseInterceptor?.({
        url: response.config.url ?? 'UNKNOWN URL',
        status: response.status,
        headers: response.headers,
        data: response.data,
      });
      return response;
    });
  };
}
