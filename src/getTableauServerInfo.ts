import { ZodiosError } from '@zodios/core';
import { fromError, isZodErrorLike } from 'zod-validation-error/v3';

import { getConfig } from './config.js';
import { ServerMethods } from './sdks/tableau/methods/serverMethods.js';
import { RestApi } from './sdks/tableau/restApi.js';
import { ServerInfo } from './sdks/tableau/types/serverInfo.js';
import { ExpiringMap } from './utils/expiringMap.js';
import { getExceptionMessage } from './utils/getExceptionMessage.js';

// The bootstrap version is used only for the initial server info call, before the
// actual REST API version is known. Tableau's /serverinfo endpoint is stable across
// API versions, so this version is safe to hard-code here and nowhere else.
const BOOTSTRAP_API_VERSION = '3.24';

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

  const bootstrapBaseUrl = `${RestApi.host}/api/${BOOTSTRAP_API_VERSION}`;
  const serverMethods = new ServerMethods(bootstrapBaseUrl, {
    timeout: getConfig().maxRequestTimeoutMs,
  });

  try {
    const serverInfo = await serverMethods.getServerInfo();
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
