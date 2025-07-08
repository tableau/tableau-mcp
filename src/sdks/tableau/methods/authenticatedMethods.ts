import { ZodiosEndpointDefinitions, ZodiosInstance } from '@zodios/core';

import { Credentials } from '../types/credentials.js';
import Methods from './methods.js';

type AuthHeaders = {
  headers: {
    'X-Tableau-Auth': string;
  };
};

export type Auth =
  | {
      type: 'credentials';
      creds: Credentials;
    }
  | {
      type: 'accessToken';
      accessToken: string;
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
  private _auth: Auth;

  protected get authHeader(): AuthHeaders {
    if (this._auth.type === 'accessToken') {
      return {
        headers: {
          'X-Tableau-Auth': this._auth.accessToken,
        },
      };
    }

    if (!this._auth.creds) {
      throw new Error('Authenticate by calling signIn() first');
    }

    return {
      headers: {
        'X-Tableau-Auth': this._auth.creds.token,
      },
    };
  }

  constructor(apiClient: ZodiosInstance<T>, auth: Auth) {
    super(apiClient);
    this._auth = auth;
  }
}
