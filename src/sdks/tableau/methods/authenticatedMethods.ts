import { ZodiosEndpointDefinitions, ZodiosInstance } from '@zodios/core';

import { Credentials } from '../types/credentials.js';
import Methods from './methods.js';

type AuthHeaders = {
  headers: {
    'X-Tableau-Auth': string;
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
  private _creds: Credentials;

  protected get authHeader(): AuthHeaders {
    if (!this._creds) {
      throw new Error('Authenticate by calling signIn() first');
    }

    return {
      headers: {
        'X-Tableau-Auth': this._creds.token,
      },
    };
  }

  protected get userId(): string {
    if (!this._creds) {
      throw new Error('Authenticate by calling signIn() first');
    }
    return this._creds.user.id;
  }

  constructor(apiClient: ZodiosInstance<T>, creds: Credentials) {
    super(apiClient);
    this._creds = creds;
  }
}
