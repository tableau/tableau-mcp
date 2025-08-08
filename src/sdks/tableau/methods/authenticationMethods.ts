import { Zodios } from '@zodios/core';

import { getJwt } from '../../../utils/getJwt.js';
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
 * @link https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_authentication.htm
 */
export default class AuthenticationMethods extends Methods<typeof authenticationApis> {
  constructor(baseUrl: string) {
    super(new Zodios(baseUrl, authenticationApis));
  }

  /**
   * Signs you in as a user on the specified site on Tableau Server or Tableau Cloud.
   *
   * @param {AuthConfig} authConfig - The authentication configuration
   * @link https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_authentication.htm#sign_in
   */
  signIn = async (authConfig: AuthConfig): Promise<Credentials> => {
    return (
      await this._apiClient.signIn({
        credentials: {
          site: {
            contentUrl: authConfig.siteName,
          },
          ...(await (async () => {
            switch (authConfig.type) {
              case 'pat':
                return {
                  personalAccessTokenName: authConfig.patName,
                  personalAccessTokenSecret: authConfig.patValue,
                };
              case 'direct-trust':
                return {
                  jwt: await getJwt({
                    username: authConfig.username,
                    connectedApp: {
                      clientId: authConfig.clientId,
                      secretId: authConfig.secretId,
                      secretValue: authConfig.secretValue,
                    },
                    scopes: authConfig.scopes,
                    additionalPayload: authConfig.additionalPayload,
                  }),
                };
            }
          })()),
        },
      })
    ).credentials;
  };
}

/**
 * Authentication methods of the Tableau Server REST API that assume the user is already authenticated
 *
 * @export
 * @class AuthenticatedAuthenticationMethods
 * @link https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_authentication.htm
 */
export class AuthenticatedAuthenticationMethods extends AuthenticatedMethods<
  typeof authenticationApis
> {
  constructor(baseUrl: string, creds: Credentials) {
    super(new Zodios(baseUrl, authenticationApis), creds);
  }

  /**
   * Signs you out of the current session. This call invalidates the authentication token that is created by a call to Sign In.
   * @link https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_authentication.htm#sign_out
   *
   * Required scopes: none
   *
   */
  signOut = async (): Promise<void> => {
    await this._apiClient.signOut(undefined, {
      ...this.authHeader,
    });
  };
}
