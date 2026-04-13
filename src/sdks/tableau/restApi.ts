import { fromError } from 'zod-validation-error/v3';

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
import McpSettingsMethods from './methods/mcpSettingsMethods.js';
import MetadataMethods from './methods/metadataMethods.js';
import PulseMethods from './methods/pulseMethods.js';
import { AuthenticatedServerMethods, ServerMethods } from './methods/serverMethods.js';
import ViewsMethods from './methods/viewsMethods.js';
import VizqlDataServiceMethods from './methods/vizqlDataServiceMethods.js';
import WorkbooksMethods from './methods/workbooksMethods.js';
import { BearerToken, bearerTokenSchema } from './types/bearerToken.js';
import { Credentials } from './types/credentials.js';

export type RestApiCredentials =
  | ({ type: 'X-Tableau-Auth' } & Credentials)
  | { type: 'Bearer'; token: string };

/**
 * Interface for the Tableau REST APIs
 *
 * @export
 * @class RestApi
 */
export class RestApi {
  private static _host: string;
  private static _version = '3.24';

  private _creds?: RestApiCredentials;
  private _maxRequestTimeoutMs: number;
  private _signal?: AbortSignal;
  private _requestInterceptor?: [RequestInterceptor, ErrorInterceptor?];
  private _responseInterceptor?: [ResponseInterceptor, ErrorInterceptor?];

  constructor(
    options: { maxRequestTimeoutMs: number } & Partial<{
      signal: AbortSignal;
      requestInterceptor: [RequestInterceptor, ErrorInterceptor?];
      responseInterceptor: [ResponseInterceptor, ErrorInterceptor?];
    }>,
  ) {
    this._maxRequestTimeoutMs = options.maxRequestTimeoutMs;
    this._signal = options.signal;
    this._requestInterceptor = options.requestInterceptor;
    this._responseInterceptor = options.responseInterceptor;
  }

  public static get isHostSet(): boolean {
    return !!RestApi._host;
  }

  public static set host(host: string) {
    RestApi._host = host;
  }

  public static get host(): string {
    if (!RestApi._host) {
      throw new Error('Rest API host not set');
    }

    return RestApi._host;
  }

  public static get version(): string {
    return RestApi._version;
  }

  public static set version(version: string) {
    RestApi._version = version;
  }

  private static get baseUrl(): string {
    return `${RestApi.host}/api/${RestApi._version}`;
  }

  private static get baseUrlWithoutVersion(): string {
    return `${RestApi.host}/api/-`;
  }

  private get creds(): RestApiCredentials {
    if (!this._creds) {
      throw new Error('No credentials found. Authenticate by calling signIn() first.');
    }

    return this._creds;
  }

  get siteId(): string {
    if (this.creds.type === 'X-Tableau-Auth') {
      return this.creds.site.id;
    }

    return getBearerTokenPayload(this.creds.token)['https://tableau.com/siteId'];
  }

  get userId(): string {
    if (this.creds.type === 'X-Tableau-Auth') {
      return this.creds.user.id;
    }

    return getBearerTokenPayload(this.creds.token)['https://tableau.com/userId'] ?? '';
  }

  private get authenticationMethods(): AuthenticationMethods {
    const authenticationMethods = new AuthenticationMethods(RestApi.baseUrl, {
      timeout: this._maxRequestTimeoutMs,
      signal: this._signal,
    });
    this._addInterceptors(RestApi.baseUrl, authenticationMethods.interceptors);
    return authenticationMethods;
  }

  private get authenticatedAuthenticationMethods(): AuthenticatedAuthenticationMethods {
    const authenticatedAuthenticationMethods = new AuthenticatedAuthenticationMethods(
      RestApi.baseUrl,
      this.creds,
      {
        timeout: this._maxRequestTimeoutMs,
        signal: this._signal,
      },
    );
    this._addInterceptors(RestApi.baseUrl, authenticatedAuthenticationMethods.interceptors);
    return authenticatedAuthenticationMethods;
  }

  get authenticatedServerMethods(): AuthenticatedServerMethods {
    const authenticatedServerMethods = new AuthenticatedServerMethods(RestApi.baseUrl, this.creds, {
      timeout: this._maxRequestTimeoutMs,
      signal: this._signal,
    });
    this._addInterceptors(RestApi.baseUrl, authenticatedServerMethods.interceptors);
    return authenticatedServerMethods;
  }

  get contentExplorationMethods(): ContentExplorationMethods {
    const contentExplorationMethods = new ContentExplorationMethods(
      RestApi.baseUrlWithoutVersion,
      this.creds,
      {
        timeout: this._maxRequestTimeoutMs,
        signal: this._signal,
      },
    );
    this._addInterceptors(RestApi.baseUrlWithoutVersion, contentExplorationMethods.interceptors);
    return contentExplorationMethods;
  }

  get datasourcesMethods(): DatasourcesMethods {
    const datasourcesMethods = new DatasourcesMethods(RestApi.baseUrl, this.creds, {
      timeout: this._maxRequestTimeoutMs,
      signal: this._signal,
    });
    this._addInterceptors(RestApi.baseUrl, datasourcesMethods.interceptors);
    return datasourcesMethods;
  }

  get metadataMethods(): MetadataMethods {
    const baseUrl = `${RestApi.host}/api/metadata`;
    const metadataMethods = new MetadataMethods(baseUrl, this.creds, {
      timeout: this._maxRequestTimeoutMs,
      signal: this._signal,
    });
    this._addInterceptors(baseUrl, metadataMethods.interceptors);
    return metadataMethods;
  }

  get pulseMethods(): PulseMethods {
    const pulseMethods = new PulseMethods(RestApi.baseUrlWithoutVersion, this.creds, {
      timeout: this._maxRequestTimeoutMs,
      signal: this._signal,
    });
    this._addInterceptors(RestApi.baseUrlWithoutVersion, pulseMethods.interceptors);
    return pulseMethods;
  }

  get serverMethods(): ServerMethods {
    const serverMethods = new ServerMethods(RestApi.baseUrl, {
      timeout: this._maxRequestTimeoutMs,
      signal: this._signal,
    });
    this._addInterceptors(RestApi.baseUrl, serverMethods.interceptors);
    return serverMethods;
  }

  get mcpSettingsMethods(): McpSettingsMethods {
    const mcpSettingsMethods = new McpSettingsMethods(RestApi.baseUrl, this.creds, {
      timeout: this._maxRequestTimeoutMs,
      signal: this._signal,
    });
    this._addInterceptors(RestApi.baseUrl, mcpSettingsMethods.interceptors);
    return mcpSettingsMethods;
  }

  get vizqlDataServiceMethods(): VizqlDataServiceMethods {
    const baseUrl = `${RestApi.host}/api/v1/vizql-data-service`;
    const vizqlDataServiceMethods = new VizqlDataServiceMethods(baseUrl, this.creds, {
      timeout: this._maxRequestTimeoutMs,
      signal: this._signal,
    });
    this._addInterceptors(baseUrl, vizqlDataServiceMethods.interceptors);

    return vizqlDataServiceMethods;
  }

  get viewsMethods(): ViewsMethods {
    const viewsMethods = new ViewsMethods(RestApi.baseUrl, this.creds, {
      timeout: this._maxRequestTimeoutMs,
      signal: this._signal,
    });
    this._addInterceptors(RestApi.baseUrl, viewsMethods.interceptors);
    return viewsMethods;
  }

  get workbooksMethods(): WorkbooksMethods {
    const workbooksMethods = new WorkbooksMethods(RestApi.baseUrl, this.creds, {
      timeout: this._maxRequestTimeoutMs,
      signal: this._signal,
    });
    this._addInterceptors(RestApi.baseUrl, workbooksMethods.interceptors);
    return workbooksMethods;
  }

  public static versionIsAtLeast = (version: `${number}.${number}`): boolean => {
    const [currentMajor, currentMinor] = RestApi._version.split('.').map(Number);
    const [major, minor] = version.split('.').map(Number);
    return currentMajor > major || (currentMajor === major && currentMinor >= minor);
  };

  signIn = async (authConfig: AuthConfig): Promise<void> => {
    this._creds = {
      type: 'X-Tableau-Auth',
      ...(await this.authenticationMethods.signIn(authConfig)),
    };
  };

  signOut = async (): Promise<void> => {
    await this.authenticatedAuthenticationMethods.signOut();
    this._creds = undefined;
  };

  setBearerToken = (token: string): void => {
    this._creds = {
      type: 'Bearer',
      token,
    };
  };

  setCredentials = (accessToken: string, userId: string): void => {
    const siteId = getSiteLuidFromAccessToken(accessToken);
    if (!siteId) {
      throw new Error('Could not determine site ID. Access token must have 3 parts.');
    }

    this._creds = {
      type: 'X-Tableau-Auth',
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

function getBearerTokenPayload(token: string): BearerToken {
  const [_header, payload, _signature] = token.split('.');
  const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString());
  const bearerToken = bearerTokenSchema.safeParse(decoded);
  if (!bearerToken.success) {
    throw new Error(`Invalid bearer token: ${fromError(bearerToken.error).toString()}`);
  }

  return bearerToken.data;
}
