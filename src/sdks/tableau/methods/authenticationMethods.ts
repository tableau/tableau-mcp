import { Zodios } from '@zodios/core';

import { getJwt } from '../../../utils/getJwt.js';
import { authenticationApis } from '../apis/authenticationApi.js';
import { AuthConfig } from '../authConfig.js';
import { Credentials } from '../types/credentials.js';
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
    return (
      await this._apiClient.signIn({
        credentials: {
          site: {
            contentUrl: authConfig.siteName,
          },
          ...(() => {
            switch (authConfig.type) {
              case 'username-password':
                return {
                  name: authConfig.username,
                  password: authConfig.password,
                };
              case 'pat':
                return {
                  personalAccessTokenName: authConfig.patName,
                  personalAccessTokenSecret: authConfig.patValue,
                };
              case 'jwt':
                return {
                  jwt: authConfig.jwt,
                };
              case 'direct-trust':
                return {
                  jwt: getJwt({
                    username: authConfig.username,
                    connectedApp: {
                      clientId: authConfig.clientId,
                      secretId: authConfig.secretId,
                      secretValue: authConfig.secretValue,
                    },
                    scopes: authConfig.scopes,
                  }),
                };
            }
          })(),
        },
      })
    ).credentials;
  };
}
