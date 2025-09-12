import { isErrorFromAlias, Zodios } from '@zodios/core';
import { Err, Ok, Result } from 'ts-results-es';

import { isAxiosError } from '../../../../node_modules/axios/index.js';
import { getExceptionMessage } from '../../../utils/getExceptionMessage.js';
import { serverApis, Session } from '../apis/serverApi.js';
import { Credentials } from '../types/credentials.js';
import { ServerInfo } from '../types/serverInfo.js';
import AuthenticatedMethods from './authenticatedMethods.js';
import Methods from './methods.js';

/**
 * Server methods of the Tableau Server REST API
 *
 * @export
 * @class ServerMethods
 * @extends {Methods<typeof serverApis>}
 * @link https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_server.htm
 */
export class ServerMethods extends Methods<typeof serverApis> {
  constructor(baseUrl: string) {
    super(new Zodios(baseUrl, serverApis));
  }

  /**
   * Returns the version of Tableau Server and the supported version of the REST API.
   *
   * Required scopes: none
   *
   * @link https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_server.htm#server_info
   */
  getServerInfo = async (): Promise<ServerInfo> => {
    return (await this._apiClient.getServerInfo()).serverInfo;
  };
}

/**
 * Authenticated server methods of the Tableau Server REST API
 *
 * @export
 * @class AuthenticatedServerMethods
 * @extends {AuthenticatedMethods<typeof serverApis>}
 * @link https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_server.htm
 */
export class AuthenticatedServerMethods extends AuthenticatedMethods<typeof serverApis> {
  constructor(baseUrl: string, creds: Credentials) {
    super(new Zodios(baseUrl, serverApis), creds);
  }

  /**
   * Returns details of the current session of Tableau Server.
   *
   * Required scopes: tableau:sessions:read
   * Scopes added in 2026.1: https://github.com/sf-analyticscloud/monolith/pull/41191
   *
   * @link https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_server.htm#get-current-server-session
   */
  getCurrentServerSession = async (): Promise<
    Result<Session, { type: 'unauthorized' | 'unknown'; message: unknown }>
  > => {
    try {
      const response = await this._apiClient.getCurrentServerSession({
        ...this.authHeader,
      });
      return Ok(response.session);
    } catch (error) {
      if (isErrorFromAlias(this._apiClient.api, 'getCurrentServerSession', error)) {
        return Err({ type: 'unauthorized', message: error.response.data.error });
      }

      if (isAxiosError(error) && error.response) {
        return Err({ type: 'unknown', message: error.response.data });
      }

      return Err({ type: 'unknown', message: getExceptionMessage(error) });
    }
  };
}
