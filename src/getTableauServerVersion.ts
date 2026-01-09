import { ZodiosError } from '@zodios/core';
import { fromError, isZodErrorLike } from 'zod-validation-error';

import { getConfig } from './config.js';
import { RestApi } from './sdks/tableau/restApi.js';
import { ProductVersion } from './sdks/tableau/types/serverInfo.js';
import { ExpiringMap } from './utils/expiringMap.js';
import { getExceptionMessage } from './utils/getExceptionMessage.js';

let tableauServerVersions: ExpiringMap<string, ProductVersion> | undefined;

/**
 * Get the version of the Tableau Server or Cloud.
 *
 * @param server - The host name of the Tableau Server or Cloud pod.
 * @returns The version of the Tableau Server or Cloud pod.
 */
export const getTableauServerVersion = async (server?: string): Promise<ProductVersion> => {
  if (!server) {
    throw new Error('server cannot be empty');
  }

  if (!tableauServerVersions) {
    tableauServerVersions = new ExpiringMap<string, ProductVersion>({
      defaultExpirationTimeMs:
        getConfig().tableauServerVersionCheckIntervalInHours * 60 * 60 * 1000,
    });
  }

  const serverVersion = tableauServerVersions.get(server);
  if (serverVersion) {
    return serverVersion;
  }

  const restApi = new RestApi(server, {
    maxRequestTimeoutMs: getConfig().maxRequestTimeoutMs,
  });

  try {
    const serverVersion = (await restApi.serverMethods.getServerInfo()).productVersion;
    tableauServerVersions.set(server, serverVersion);
    return serverVersion;
  } catch (error) {
    const reason =
      error instanceof ZodiosError && isZodErrorLike(error.cause)
        ? fromError(error.cause).toString()
        : getExceptionMessage(error);

    throw new Error(`Failed to get server version: ${reason}`);
  }
};
