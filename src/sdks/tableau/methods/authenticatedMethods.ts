import { ZodiosEndpointDefinitions, ZodiosInstance } from '@zodios/core';

import { RestApiCredentials } from '../restApi.js';
import Methods from './methods.js';

type AuthHeaders = {
  headers:
    | {
        'X-Tableau-Auth': string;
      }
    | {
        Authorization: string;
      };
};

/**
 * Base abstract class for any methods classes that require authentication.
 *
 * @export
 * @abstract
 * @class AuthenticatedMethods
 */
export default abstract class AuthenticatedMethods<
  T extends ZodiosEndpointDefinitions,
> extends Methods<T> {
  private _creds: RestApiCredentials;

  protected get authHeader(): AuthHeaders {
    if (!this._creds) {
      throw new Error('Authenticate by calling signIn() first');
    }

    if (this._creds.type === 'X-Tableau-Auth') {
      return {
        headers: {
          'X-Tableau-Auth': this._creds.token,
        },
      };
    }

    return {
      headers: {
        Authorization: `Bearer ${this._creds.token}`,
      },
    };
  }

  protected get userId(): string {
    if (!this._creds) {
      throw new Error('Authenticate by calling signIn() first');
    }

    if (this._creds.type === 'X-Tableau-Auth') {
      return this._creds.user.id;
    }

    throw new Error('User ID can not be determined from the Bearer token alone');
  }

  constructor(apiClient: ZodiosInstance<T>, creds: RestApiCredentials) {
    super(apiClient);
    this._creds = creds;
  }
}
