import { AuthConfig } from './authConfig.js';
import {
  AxiosInterceptor,
  ErrorInterceptor,
  getRequestInterceptorConfig,
  getResponseInterceptorConfig,
  RequestInterceptor,
  ResponseInterceptor,
} from './interceptors.js';
import AuthenticationMethods from './methods/authenticationMethods.js';
import DatasourcesMethods from './methods/datasourcesMethods.js';
import MetadataMethods from './methods/metadataMethods.js';
import PulseMethods from './methods/pulseMethods.js';
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

  private _datasourcesMethods?: DatasourcesMethods;
  private _metadataMethods?: MetadataMethods;
  private _vizqlDataServiceMethods?: VizqlDataServiceMethods;
  private _pulseMethods?: PulseMethods;
  private static _version = '3.24';

  private _requestInterceptor?: [RequestInterceptor, ErrorInterceptor?];
  private _responseInterceptor?: [ResponseInterceptor, ErrorInterceptor?];

  constructor(
    host: string,
    options?: Partial<{
      requestInterceptor: [RequestInterceptor, ErrorInterceptor?];
      responseInterceptor: [ResponseInterceptor, ErrorInterceptor?];
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

  get siteId(): string {
    return this.creds.site.id;
  }

  get datasourcesMethods(): DatasourcesMethods {
    if (!this._datasourcesMethods) {
      this._datasourcesMethods = new DatasourcesMethods(this._baseUrl, this.creds);
      this._addInterceptors(this._baseUrl, this._datasourcesMethods.interceptors);
    }

    return this._datasourcesMethods;
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

  get pulseMethods(): PulseMethods {
    if (!this._pulseMethods) {
      const baseUrl = `${this._host}/api/-/`;
      this._pulseMethods = new PulseMethods(baseUrl, this.creds);
      this._addInterceptors(baseUrl, this._pulseMethods.interceptors);
    }

    return this._pulseMethods;
  }

  signIn = async (authConfig: AuthConfig): Promise<void> => {
    const authenticationMethods = new AuthenticationMethods(this._baseUrl);
    this._addInterceptors(this._baseUrl, authenticationMethods.interceptors);
    this._creds = await authenticationMethods.signIn(authConfig);
  };

  private _addInterceptors = (baseUrl: string, interceptors: AxiosInterceptor): void => {
    interceptors.request.use(
      (config) => {
        this._requestInterceptor?.[0]({
          baseUrl,
          ...getRequestInterceptorConfig(config),
        });
        return config;
      },
      (error) => {
        this._requestInterceptor?.[1]?.(error, baseUrl);
        return Promise.reject(error);
      },
    );

    interceptors.response.use(
      (response) => {
        this._responseInterceptor?.[0]({
          baseUrl,
          ...getResponseInterceptorConfig(response),
        });
        return response;
      },
      (error) => {
        this._responseInterceptor?.[1]?.(error, baseUrl);
        return Promise.reject(error);
      },
    );
  };
}
