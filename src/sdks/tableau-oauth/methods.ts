import pkg from '../../../package.json';
import { getTelemetryProvider } from '../../telemetry/init.js';
import { AxiosRequestConfig } from '../../utils/axios.js';
import { getClient } from './client.js';
import { TableauAccessToken, TableauAccessTokenRequest } from './types.js';

export async function getTokenResult(
  basePath: string,
  request: TableauAccessTokenRequest,
  axiosConfig: AxiosRequestConfig,
): Promise<TableauAccessToken> {
  const span = getTelemetryProvider().startSpan?.('tableau.oauth.token_exchange', { basePath });
  let error: unknown;
  try {
    return await getClient(basePath, axiosConfig).token(request, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': `tableau-mcp/${pkg.version}`,
      },
    });
  } catch (caughtError) {
    error = caughtError;
    throw caughtError;
  } finally {
    span?.end(error);
  }
}
