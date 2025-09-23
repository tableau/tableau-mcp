import { Zodios } from '@zodios/core';

import { serverApis } from '../apis/serverApi.js';
import { ServerInfo } from '../types/serverInfo.js';
import Methods from './methods.js';

/**
 * Server methods of the Tableau Server REST API
 *
 * @export
 * @class ServerMethods
 * @link https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_server.htm
 */
export default class ServerMethods extends Methods<typeof serverApis> {
  constructor(baseUrl: string) {
    super(new Zodios(baseUrl, serverApis));
  }

  /**
   * Returns the version of Tableau Server and the supported version of the REST API.
   *
   * @link https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_server.htm#get_server_info
   */
  getServerInfo = async (): Promise<ServerInfo> => {
    return (await this._apiClient.getServerInfo()).serverInfo;
  };
}
