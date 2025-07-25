import { isErrorFromAlias, Zodios } from '@zodios/core';
import { Err, Ok, Result } from 'ts-results-es';

import { isAxiosError } from '../../../../node_modules/axios/index.js';
import { getExceptionMessage } from '../../../utils/getExceptionMessage.js';
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
