import { AuthConfig } from './authConfig.js';
import AuthenticationMethods from './methods/authenticationMethods.js';
import MetadataMethods from './methods/metadataMethods.js';
import VizqlDataServiceMethods from './methods/vizqlDataServiceMethods.js';

type Methods = MetadataMethods | VizqlDataServiceMethods;

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

  private _methods: Array<Methods> = [];
  private _metadataMethods?: MetadataMethods;
  private _vizqlDataServiceMethods?: VizqlDataServiceMethods;

  private static _version = '3.24';

  constructor(host: string) {
    this._host = host;
    this._baseUrl = `${this._host}/api/${RestApi._version}`;
  }

  get token(): string {
    if (!this._token) {
      throw new Error('No token found. Authenticate by calling signIn() first.');
    }

    return this._token;
  }

  get methods(): ReadonlyArray<Methods> {
    return this._methods;
  }

  get metadataMethods(): MetadataMethods {
    if (!this._metadataMethods) {
      this._metadataMethods = new MetadataMethods(`${this._host}/api/metadata`, this.token);
      this._methods.push(this._metadataMethods);
    }

    return this._metadataMethods;
  }

  get vizqlDataServiceMethods(): VizqlDataServiceMethods {
    if (!this._vizqlDataServiceMethods) {
      this._vizqlDataServiceMethods = new VizqlDataServiceMethods(
        `${this._host}/api/v1/vizql-data-service`,
        this.token,
      );
      this._methods.push(this._vizqlDataServiceMethods);
    }

    return this._vizqlDataServiceMethods;
  }

  signIn = async (authConfig: AuthConfig): Promise<void> => {
    const authenticationMethods = new AuthenticationMethods(this._baseUrl);
    this._token = (await authenticationMethods.signIn(authConfig)).token;
  };
}
