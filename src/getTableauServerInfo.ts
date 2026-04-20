import { ZodiosError } from '@zodios/core';
import { fromError, isZodErrorLike } from 'zod-validation-error/v3';

import { getConfig } from './config.web.js';
import { RestApi } from './sdks/tableau/restApi.js';
import { ServerInfo } from './sdks/tableau/types/serverInfo.js';
import { ExpiringMap } from './utils/expiringMap.js';
import { getExceptionMessage } from './utils/getExceptionMessage.js';

let tableauServerInfoCache: ExpiringMap<string, ServerInfo> | undefined;

/**
 * Get the server info for a Tableau Server or Cloud pod.
 *
 * @param server - The host name of the Tableau Server or Cloud pod.
 * @returns Server info for the Tableau Server or Cloud pod.
 */
export const getTableauServerInfo = async (server?: string): Promise<ServerInfo> => {
  if (!server) {
    throw new Error('server cannot be empty');
  }

  if (!tableauServerInfoCache) {
    tableauServerInfoCache = new ExpiringMap<string, ServerInfo>({
      defaultExpirationTimeMs:
        getConfig().tableauServerVersionCheckIntervalInHours * 60 * 60 * 1000,
    });
  }

  const serverInfo = tableauServerInfoCache.get(server);
  if (serverInfo) {
    return serverInfo;
  }

  const restApi = new RestApi({
    maxRequestTimeoutMs: getConfig().maxRequestTimeoutMs,
  });

  try {
    const serverInfo = await restApi.serverMethods.getServerInfo();
    RestApi.version = serverInfo.restApiVersion;
    tableauServerInfoCache.set(server, serverInfo);
    return serverInfo;
  } catch (error) {
    const reason =
      error instanceof ZodiosError && isZodErrorLike(error.cause)
        ? fromError(error.cause).toString()
        : getExceptionMessage(error);

    throw new Error(`Failed to get server info: ${reason}`);
  }
};
