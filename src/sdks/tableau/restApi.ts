import { ZodiosClass } from '@zodios/core';

import { AuthConfig } from './authConfig.js';
import { ResponseInterceptor } from './interceptors.js';
import { RequestInterceptor } from './interceptors.js';
import AuthenticationMethods from './methods/authenticationMethods.js';
import MetadataMethods from './methods/metadataMethods.js';
import VizqlDataServiceMethods from './methods/vizqlDataServiceMethods.js';
import { Credentials } from './types/credentials.js';

/**
 * Interface for the Tableau REST APIs
 *
 * @export
 * @class RestApi
 */
export default class RestApi {
  private _creds?: Credentials;
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

  private get creds(): Credentials {
    if (!this._creds) {
      throw new Error('No credentials found. Authenticate by calling signIn() first.');
    }

    return this._creds;
  }

  get metadataMethods(): MetadataMethods {
    if (!this._metadataMethods) {
      const baseUrl = `${this._host}/api/metadata`;
      this._metadataMethods = new MetadataMethods(baseUrl, this.creds);
      this._addInterceptors(baseUrl, this._metadataMethods.interceptors);
    }

    return this._metadataMethods;
  }

  get vizqlDataServiceMethods(): VizqlDataServiceMethods {
    if (!this._vizqlDataServiceMethods) {
      const baseUrl = `${this._host}/api/v1/vizql-data-service`;
      this._vizqlDataServiceMethods = new VizqlDataServiceMethods(baseUrl, this.creds);
      this._addInterceptors(baseUrl, this._vizqlDataServiceMethods.interceptors);
    }

    return this._vizqlDataServiceMethods;
  }

  signIn = async (authConfig: AuthConfig): Promise<void> => {
    const authenticationMethods = new AuthenticationMethods(this._baseUrl);
    this._addInterceptors(this._baseUrl, authenticationMethods.interceptors);
    this._creds = await authenticationMethods.signIn(authConfig);
  };

  private _addInterceptors = (
    baseUrl: string,
    interceptors: ZodiosClass<any>['axios']['interceptors'],
  ): void => {
    interceptors.request.use((config) => {
      this._requestInterceptor?.({
        method: config.method ?? 'UNKNOWN METHOD',
        baseUrl,
        url: config.url ?? 'UNKNOWN URL',
        headers: config.headers,
        data: config.data,
      });
      return config;
    });

    interceptors.response.use((response) => {
      this._responseInterceptor?.({
        baseUrl,
        url: response.config.url ?? 'UNKNOWN URL',
        status: response.status,
        headers: response.headers,
        data: response.data,
      });
      return response;
    });
  };
}
