import { getSiteLuidFromAccessToken } from '../../utils/getSiteLuidFromAccessToken.js';
import { AuthConfig } from './authConfig.js';
import {
  AxiosInterceptor,
  ErrorInterceptor,
  getRequestInterceptorConfig,
  getResponseInterceptorConfig,
  RequestInterceptor,
  ResponseInterceptor,
} from './interceptors.js';
import {
  AuthenticatedAuthenticationMethods,
  AuthenticationMethods,
} from './methods/authenticationMethods.js';
import ContentExplorationMethods from './methods/contentExplorationMethods.js';
import DatasourcesMethods from './methods/datasourcesMethods.js';
import MetadataMethods from './methods/metadataMethods.js';
import PulseMethods from './methods/pulseMethods.js';
import { AuthenticatedServerMethods, ServerMethods } from './methods/serverMethods.js';
import ViewsMethods from './methods/viewsMethods.js';
import VizqlDataServiceMethods from './methods/vizqlDataServiceMethods.js';
import WorkbooksMethods from './methods/workbooksMethods.js';
import { Credentials } from './types/credentials.js';

/**
 * Interface for the Tableau REST APIs
 *
 * @export
 * @class RestApi
 */
export class RestApi {
  private _creds?: Credentials;
  private readonly _host: string;
  private readonly _baseUrl: string;
  private readonly _baseUrlWithoutVersion: string;

  private _authenticationMethods?: AuthenticationMethods;
  private _authenticatedAuthenticationMethods?: AuthenticatedAuthenticationMethods;
  private _authenticatedServerMethods?: AuthenticatedServerMethods;
  private _contentExplorationMethods?: ContentExplorationMethods;
  private _datasourcesMethods?: DatasourcesMethods;
  private _metadataMethods?: MetadataMethods;
  private _pulseMethods?: PulseMethods;
  private _serverMethods?: ServerMethods;
  private _vizqlDataServiceMethods?: VizqlDataServiceMethods;
  private _viewsMethods?: ViewsMethods;
  private _workbooksMethods?: WorkbooksMethods;
  private static _version = '3.24';

  private _maxRequestTimeoutMs: number;
  private _signal?: AbortSignal;
  private _requestInterceptor?: [RequestInterceptor, ErrorInterceptor?];
  private _responseInterceptor?: [ResponseInterceptor, ErrorInterceptor?];

  constructor(
    host: string,
    options: { maxRequestTimeoutMs: number } & Partial<{
      signal: AbortSignal;
      requestInterceptor: [RequestInterceptor, ErrorInterceptor?];
      responseInterceptor: [ResponseInterceptor, ErrorInterceptor?];
    }>,
  ) {
    this._host = host;
    this._baseUrl = `${this._host}/api/${RestApi._version}`;
    this._baseUrlWithoutVersion = `${this._host}/api/-`;
    this._maxRequestTimeoutMs = options.maxRequestTimeoutMs;
    this._signal = options.signal;
    this._requestInterceptor = options.requestInterceptor;
    this._responseInterceptor = options.responseInterceptor;
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

  private get authenticationMethods(): AuthenticationMethods {
    if (!this._authenticationMethods) {
      this._authenticationMethods = new AuthenticationMethods(this._baseUrl, {
        timeout: this._maxRequestTimeoutMs,
        signal: this._signal,
      });
      this._addInterceptors(this._baseUrl, this._authenticationMethods.interceptors);
    }
    return this._authenticationMethods;
  }

  private get authenticatedAuthenticationMethods(): AuthenticatedAuthenticationMethods {
    if (!this._authenticatedAuthenticationMethods) {
      this._authenticatedAuthenticationMethods = new AuthenticatedAuthenticationMethods(
        this._baseUrl,
        this.creds,
        {
          timeout: this._maxRequestTimeoutMs,
          signal: this._signal,
        },
      );
      this._addInterceptors(this._baseUrl, this._authenticatedAuthenticationMethods.interceptors);
    }
    return this._authenticatedAuthenticationMethods;
  }

  get authenticatedServerMethods(): AuthenticatedServerMethods {
    if (!this._authenticatedServerMethods) {
      this._authenticatedServerMethods = new AuthenticatedServerMethods(this._baseUrl, this.creds, {
        timeout: this._maxRequestTimeoutMs,
        signal: this._signal,
      });
      this._addInterceptors(this._baseUrl, this._authenticatedServerMethods.interceptors);
    }
    return this._authenticatedServerMethods;
  }

  get contentExplorationMethods(): ContentExplorationMethods {
    if (!this._contentExplorationMethods) {
      this._contentExplorationMethods = new ContentExplorationMethods(
        this._baseUrlWithoutVersion,
        this.creds,
        {
          timeout: this._maxRequestTimeoutMs,
          signal: this._signal,
        },
      );
      this._addInterceptors(
        this._baseUrlWithoutVersion,
        this._contentExplorationMethods.interceptors,
      );
    }

    return this._contentExplorationMethods;
  }

  get datasourcesMethods(): DatasourcesMethods {
    if (!this._datasourcesMethods) {
      this._datasourcesMethods = new DatasourcesMethods(this._baseUrl, this.creds, {
        timeout: this._maxRequestTimeoutMs,
        signal: this._signal,
      });
      this._addInterceptors(this._baseUrl, this._datasourcesMethods.interceptors);
    }

    return this._datasourcesMethods;
  }

  get metadataMethods(): MetadataMethods {
    if (!this._metadataMethods) {
      const baseUrl = `${this._host}/api/metadata`;
      this._metadataMethods = new MetadataMethods(baseUrl, this.creds, {
        timeout: this._maxRequestTimeoutMs,
        signal: this._signal,
      });
      this._addInterceptors(baseUrl, this._metadataMethods.interceptors);
    }

    return this._metadataMethods;
  }

  get pulseMethods(): PulseMethods {
    if (!this._pulseMethods) {
      this._pulseMethods = new PulseMethods(this._baseUrlWithoutVersion, this.creds, {
        timeout: this._maxRequestTimeoutMs,
        signal: this._signal,
      });
      this._addInterceptors(this._baseUrlWithoutVersion, this._pulseMethods.interceptors);
    }

    return this._pulseMethods;
  }

  get serverMethods(): ServerMethods {
    if (!this._serverMethods) {
      this._serverMethods = new ServerMethods(this._baseUrl, {
        timeout: this._maxRequestTimeoutMs,
        signal: this._signal,
      });
      this._addInterceptors(this._baseUrl, this._serverMethods.interceptors);
    }

    return this._serverMethods;
  }

  get vizqlDataServiceMethods(): VizqlDataServiceMethods {
    if (!this._vizqlDataServiceMethods) {
      const baseUrl = `${this._host}/api/v1/vizql-data-service`;
      this._vizqlDataServiceMethods = new VizqlDataServiceMethods(baseUrl, this.creds, {
        timeout: this._maxRequestTimeoutMs,
        signal: this._signal,
      });
      this._addInterceptors(baseUrl, this._vizqlDataServiceMethods.interceptors);
    }

    return this._vizqlDataServiceMethods;
  }

  get viewsMethods(): ViewsMethods {
    if (!this._viewsMethods) {
      this._viewsMethods = new ViewsMethods(this._baseUrl, this.creds, {
        timeout: this._maxRequestTimeoutMs,
        signal: this._signal,
      });
      this._addInterceptors(this._baseUrl, this._viewsMethods.interceptors);
    }

    return this._viewsMethods;
  }

  get workbooksMethods(): WorkbooksMethods {
    if (!this._workbooksMethods) {
      this._workbooksMethods = new WorkbooksMethods(this._baseUrl, this.creds, {
        timeout: this._maxRequestTimeoutMs,
        signal: this._signal,
      });
      this._addInterceptors(this._baseUrl, this._workbooksMethods.interceptors);
    }

    return this._workbooksMethods;
  }

  signIn = async (authConfig: AuthConfig): Promise<void> => {
    this._creds = await this.authenticationMethods.signIn(authConfig);
  };

  signOut = async (): Promise<void> => {
    await this.authenticatedAuthenticationMethods.signOut();
    this._creds = undefined;
  };

  setCredentials = (accessToken: string, userId: string): void => {
    const siteId = getSiteLuidFromAccessToken(accessToken);
    if (!siteId) {
      throw new Error('Could not determine site ID. Access token must have 3 parts.');
    }

    this._creds = {
      site: {
        id: siteId,
      },
      user: {
        id: userId,
      },
      token: accessToken,
    };
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
