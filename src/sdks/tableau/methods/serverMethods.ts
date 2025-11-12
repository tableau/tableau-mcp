import { isErrorFromAlias, Zodios } from '@zodios/core';
import { Err, Ok, Result } from 'ts-results-es';

import { getExceptionMessage } from '../../../utils/getExceptionMessage.js';
import { isAxiosError } from '../../../utils/isAxiosError.js';
import { serverApis, Session } from '../apis/serverApi.js';
import { Credentials } from '../types/credentials.js';
import { ServerInfo } from '../types/serverInfo.js';
import AuthenticatedMethods from './authenticatedMethods.js';

/**
 * Server methods of the Tableau Server REST API
 *
 * @export
 * @class ServerMethods
 * @extends {AuthenticatedMethods<typeof serverApis>}
 * @link https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_server.htm
 */
export default class ServerMethods extends AuthenticatedMethods<typeof serverApis> {
  constructor(baseUrl: string, creds: Credentials) {
    super(new Zodios(baseUrl, serverApis), creds);
  }

  /**
   * Returns the version of Tableau Server and the supported version of the REST API.
   *
   * @link https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_server.htm#get_server_info
   */
  getServerInfo = async (): Promise<ServerInfo> => {
    return (await this._apiClient.getServerInfo()).serverInfo;
  };

  /**
   * Returns details of the current session of Tableau Server.
   *
   * Required scopes: none
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
