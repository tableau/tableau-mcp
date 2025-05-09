import { ZodiosEndpointDefinitions, ZodiosInstance } from '@zodios/core';

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
  private _token: string;

  protected get authHeader(): AuthHeaders {
    if (!this._token) {
      throw new Error('Authenticate by calling signIn() first');
    }

    return {
      headers: {
        'X-Tableau-Auth': this._token,
      },
    };
  }

  constructor(apiClient: ZodiosInstance<T>, token: string) {
    super(apiClient);
    this._token = token;
  }
}
