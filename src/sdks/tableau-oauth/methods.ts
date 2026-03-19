import { userAgent } from '../../server.js';
import { AxiosRequestConfig } from '../../utils/axios.js';
import { getClient } from './client.js';
import { TableauAccessToken, TableauAccessTokenRequest } from './types.js';

export async function getTokenResult(
  basePath: string,
  request: TableauAccessTokenRequest,
  axiosConfig: AxiosRequestConfig,
): Promise<TableauAccessToken> {
  return await getClient(basePath, axiosConfig).token(request, {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': userAgent,
    },
  });
}
