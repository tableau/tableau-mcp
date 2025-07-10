import { AuthConfig } from './authConfig.js';
import {
  AxiosInterceptor,
  ErrorInterceptor,
  getRequestInterceptorConfig,
  getResponseInterceptorConfig,
  RequestInterceptor,
  ResponseInterceptor,
} from './interceptors.js';
import { Auth } from './methods/authenticatedMethods.js';
import AuthenticationMethods, {
  AuthenticatedAuthenticationMethods,
} from './methods/authenticationMethods.js';
import DatasourcesMethods from './methods/datasourcesMethods.js';
import MetadataMethods from './methods/metadataMethods.js';
import ServerMethods from './methods/serverMethods.js';
import VizqlDataServiceMethods from './methods/vizqlDataServiceMethods.js';

/**
 * Interface for the Tableau REST APIs
 *
 * @export
 * @class RestApi
 */
export default class RestApi {
  private _auth?: Auth;
  private readonly _host: string;
  private readonly _baseUrl: string;

  private _datasourcesMethods?: DatasourcesMethods;
  private _metadataMethods?: MetadataMethods;
  private _serverMethods?: ServerMethods;
  private _vizqlDataServiceMethods?: VizqlDataServiceMethods;
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

  private get auth(): Auth {
    if (!this._auth) {
      throw new Error('No credentials found. Authenticate by calling signIn() first.');
    }

    return this._auth;
  }

  set accessToken(accessToken: string) {
    this._auth = { type: 'accessToken', accessToken };
  }

  get siteId(): string {
    if (this.auth.type === 'accessToken') {
      const parts = this.auth.accessToken.split('|');
      if (parts.length > 2) {
        return parts[2];
      }

      throw new Error('Could not determine site ID. Access token must have 3 parts.');
    }

    return this.auth.creds.site.id;
  }

  get datasourcesMethods(): DatasourcesMethods {
    if (!this._datasourcesMethods) {
      this._datasourcesMethods = new DatasourcesMethods(this._baseUrl, this.auth);
      this._addInterceptors(this._baseUrl, this._datasourcesMethods.interceptors);
    }

    return this._datasourcesMethods;
  }

  get metadataMethods(): MetadataMethods {
    if (!this._metadataMethods) {
      const baseUrl = `${this._host}/api/metadata`;
      this._metadataMethods = new MetadataMethods(baseUrl, this.auth);
      this._addInterceptors(baseUrl, this._metadataMethods.interceptors);
    }

    return this._metadataMethods;
  }

  get serverMethods(): ServerMethods {
    if (!this._serverMethods) {
      this._serverMethods = new ServerMethods(this._baseUrl, this.auth);
      this._addInterceptors(this._baseUrl, this._serverMethods.interceptors);
    }

    return this._serverMethods;
  }

  get vizqlDataServiceMethods(): VizqlDataServiceMethods {
    if (!this._vizqlDataServiceMethods) {
      const baseUrl = `${this._host}/api/v1/vizql-data-service`;
      this._vizqlDataServiceMethods = new VizqlDataServiceMethods(baseUrl, this.auth);
      this._addInterceptors(baseUrl, this._vizqlDataServiceMethods.interceptors);
    }

    return this._vizqlDataServiceMethods;
  }

  signIn = async (authConfig: AuthConfig): Promise<void> => {
    const authenticationMethods = new AuthenticationMethods(this._baseUrl);
    this._addInterceptors(this._baseUrl, authenticationMethods.interceptors);
    this._auth = { type: 'credentials', creds: await authenticationMethods.signIn(authConfig) };
  };

  signOut = async (): Promise<void> => {
    const authenticationMethods = new AuthenticatedAuthenticationMethods(this._baseUrl, this.auth);
    this._addInterceptors(this._baseUrl, authenticationMethods.interceptors);
    await authenticationMethods.signOut();
    this._auth = undefined;
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
