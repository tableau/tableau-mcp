import { Zodios } from '@zodios/core';

import { authenticationApis } from '../apis/authenticationApi.js';
import { AuthConfig } from '../authConfig.js';
import { Credentials } from '../types/credentials.js';
import AuthenticatedMethods from './authenticatedMethods.js';
import Methods from './methods.js';

/**
 * Authentication methods of the Tableau Server REST API
 *
 * @export
 * @class AuthenticationMethods
 * @link https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_authentication.htm#sign_in
 */
export default class AuthenticationMethods extends Methods<typeof authenticationApis> {
  constructor(baseUrl: string) {
    super(new Zodios(baseUrl, authenticationApis));
  }

  signIn = async (authConfig: AuthConfig): Promise<Credentials> => {
    if (authConfig.type === 'accessToken') {
      throw new Error('Access token authentication is not supported');
    }

    return (
      await this._apiClient.signIn({
        credentials: {
          site: {
            contentUrl: authConfig.siteName,
          },
          ...(() => {
            switch (authConfig.type) {
              case 'pat':
                return {
                  personalAccessTokenName: authConfig.patName,
                  personalAccessTokenSecret: authConfig.patValue,
                };
            }
          })(),
        },
      })
    ).credentials;
  };
}

export class AuthenticatedAuthenticationMethods extends AuthenticatedMethods<
  typeof authenticationApis
> {
  constructor(baseUrl: string, creds: Credentials) {
    super(new Zodios(baseUrl, authenticationApis), creds);
  }

  signOut = async (): Promise<void> => {
    await this._apiClient.signOut(undefined, {
      ...this.authHeader,
    });
  };
}
