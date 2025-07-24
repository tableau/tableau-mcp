import { userAgent } from '../../server/userAgent.js';
import { getClient } from './client.js';
import { TableauAccessToken, TableauAccessTokenRequest } from './types.js';

export async function getTokenResult(
  basePath: string,
  request: TableauAccessTokenRequest,
): Promise<TableauAccessToken> {
  return await getClient(basePath).token(request, {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': userAgent,
    },
  });
}
