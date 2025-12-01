import { AuthConfig } from './authConfig.js';
import {
  AxiosInterceptor,
  ErrorInterceptor,
  getRequestInterceptorConfig,
  getResponseInterceptorConfig,
  RequestInterceptor,
  ResponseInterceptor,
} from './interceptors.js';
import AuthenticationMethods, {
  AuthenticatedAuthenticationMethods,
} from './methods/authenticationMethods.js';
import ContentExplorationMethods from './methods/contentExplorationMethods.js';
import DatasourcesMethods from './methods/datasourcesMethods.js';
import MetadataMethods from './methods/metadataMethods.js';
import PublishingMethods from './methods/publishingMethods.js';
import PulseMethods from './methods/pulseMethods.js';
import ServerMethods from './methods/serverMethods.js';
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
  private _contentExplorationMethods?: ContentExplorationMethods;
  private _datasourcesMethods?: DatasourcesMethods;
  private _metadataMethods?: MetadataMethods;
  private _publishingMethods?: PublishingMethods;
  private _pulseMethods?: PulseMethods;
  private _serverMethods?: ServerMethods;
  private _vizqlDataServiceMethods?: VizqlDataServiceMethods;
  private _viewsMethods?: ViewsMethods;
  private _workbooksMethods?: WorkbooksMethods;
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
    this._baseUrlWithoutVersion = `${this._host}/api/-`;
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

  private get authenticationMethods(): AuthenticationMethods {
    if (!this._authenticationMethods) {
      this._authenticationMethods = new AuthenticationMethods(this._baseUrl);
      this._addInterceptors(this._baseUrl, this._authenticationMethods.interceptors);
    }
    return this._authenticationMethods;
  }

  private get authenticatedAuthenticationMethods(): AuthenticatedAuthenticationMethods {
    if (!this._authenticatedAuthenticationMethods) {
      this._authenticatedAuthenticationMethods = new AuthenticatedAuthenticationMethods(
        this._baseUrl,
        this.creds,
      );
      this._addInterceptors(this._baseUrl, this._authenticatedAuthenticationMethods.interceptors);
    }
    return this._authenticatedAuthenticationMethods;
  }

  get contentExplorationMethods(): ContentExplorationMethods {
    if (!this._contentExplorationMethods) {
      this._contentExplorationMethods = new ContentExplorationMethods(
        this._baseUrlWithoutVersion,
        this.creds,
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

  get publishingMethods(): PublishingMethods {
    if (!this._publishingMethods) {
      this._publishingMethods = new PublishingMethods(this._baseUrl, this.creds);
      this._addInterceptors(this._baseUrl, this._publishingMethods.interceptors);
    }

    return this._publishingMethods;
  }

  get pulseMethods(): PulseMethods {
    if (!this._pulseMethods) {
      this._pulseMethods = new PulseMethods(this._baseUrlWithoutVersion, this.creds);
      this._addInterceptors(this._baseUrlWithoutVersion, this._pulseMethods.interceptors);
    }

    return this._pulseMethods;
  }

  get serverMethods(): ServerMethods {
    if (!this._serverMethods) {
      this._serverMethods = new ServerMethods(this._baseUrl, this.creds);
      this._addInterceptors(this._baseUrl, this._serverMethods.interceptors);
    }

    return this._serverMethods;
  }

  get vizqlDataServiceMethods(): VizqlDataServiceMethods {
    if (!this._vizqlDataServiceMethods) {
      const baseUrl = `${this._host}/api/v1/vizql-data-service`;
      this._vizqlDataServiceMethods = new VizqlDataServiceMethods(baseUrl, this.creds);
      this._addInterceptors(baseUrl, this._vizqlDataServiceMethods.interceptors);
    }

    return this._vizqlDataServiceMethods;
  }

  get viewsMethods(): ViewsMethods {
    if (!this._viewsMethods) {
      this._viewsMethods = new ViewsMethods(this._baseUrl, this.creds);
      this._addInterceptors(this._baseUrl, this._viewsMethods.interceptors);
    }

    return this._viewsMethods;
  }

  get workbooksMethods(): WorkbooksMethods {
    if (!this._workbooksMethods) {
      this._workbooksMethods = new WorkbooksMethods(this._baseUrl, this.creds);
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
    const parts = accessToken.split('|');
    if (parts.length < 3) {
      throw new Error('Could not determine site ID. Access token must have 3 parts.');
    }

    const siteId = parts[2];
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
