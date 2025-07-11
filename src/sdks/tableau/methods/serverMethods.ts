import { Zodios } from '@zodios/core';

import { serverApis, Session } from '../apis/serverApi.js';
import { Credentials } from '../types/credentials.js';
import AuthenticatedMethods from './authenticatedMethods.js';

export default class ServerMethods extends AuthenticatedMethods<typeof serverApis> {
  constructor(baseUrl: string, creds: Credentials) {
    super(new Zodios(baseUrl, serverApis), creds);
  }

  /**
   * Returns details of the current session of Tableau Server.
   */
  getCurrentServerSession = async (): Promise<Session> => {
    const response = await this._apiClient.getCurrentServerSession({
      ...this.authHeader,
    });
    return response.session;
  };
}
