import { RequestId } from '@modelcontextprotocol/sdk/types.js';

import { isAxiosError } from '../node_modules/axios/index.js';
import { Config, getConfig } from './config.js';
import { log, shouldLogWhenLevelIsAtLeast } from './logging/log.js';
import { maskRequest, maskResponse } from './logging/secretMask.js';
import {
  AxiosResponseInterceptorConfig,
  ErrorInterceptor,
  getRequestInterceptorConfig,
  getResponseInterceptorConfig,
  RequestInterceptor,
  RequestInterceptorConfig,
  ResponseInterceptor,
  ResponseInterceptorConfig,
} from './sdks/tableau/interceptors.js';
import RestApi from './sdks/tableau/restApi.js';
import { Server } from './server.js';
import { userAgent } from './server/userAgent.js';
import { getExceptionMessage } from './utils/getExceptionMessage.js';

const getNewRestApiInstanceAsync = async (
  config: Config,
  requestId: RequestId,
  server: Server,
  authInfo?: { accessToken?: string; userId?: string },
): Promise<RestApi> => {
  const restApi = new RestApi(config.server, {
    requestInterceptor: [
      getRequestInterceptor(server, requestId),
      getRequestErrorInterceptor(server, requestId),
    ],
    responseInterceptor: [
      getResponseInterceptor(server, requestId),
      getResponseErrorInterceptor(server, requestId),
    ],
  });

  if (config.auth === 'pat') {
    await restApi.signIn({
      type: 'pat',
      patName: config.patName,
      patValue: config.patValue,
      siteName: config.siteName,
    });
  } else {
    restApi.setCredentials(authInfo?.accessToken ?? '', authInfo?.userId ?? '');
  }

  return restApi;
};

export const useRestApi = async <T>({
  config,
  requestId,
  server,
  callback,
  authInfo,
}: {
  config: Config;
  requestId: RequestId;
  server: Server;
  callback: (restApi: RestApi) => Promise<T>;
  authInfo?: { accessToken?: string; userId?: string };
}): Promise<T> => {
  const restApi = await getNewRestApiInstanceAsync(config, requestId, server, authInfo);
  try {
    return await callback(restApi);
  } finally {
    if (config.auth === 'pat') {
      await restApi.signOut();
    }
  }
};

export const getRequestInterceptor =
  (server: Server, requestId: RequestId): RequestInterceptor =>
  (request) => {
    request.headers['User-Agent'] = userAgent;
    logRequest(server, request, requestId);
    return request;
  };

export const getRequestErrorInterceptor =
  (server: Server, requestId: RequestId): ErrorInterceptor =>
  (error, baseUrl) => {
    if (!isAxiosError(error) || !error.request) {
      log.error(server, `Request ${requestId} failed with error: ${getExceptionMessage(error)}`, {
        logger: 'rest-api',
        requestId,
      });
      return;
    }

    const { request } = error;
    logRequest(
      server,
      {
        baseUrl,
        ...getRequestInterceptorConfig(request),
      },
      requestId,
    );
  };

export const getResponseInterceptor =
  (server: Server, requestId: RequestId): ResponseInterceptor =>
  (response) => {
    logResponse(server, response, requestId);
    return response;
  };

export const getResponseErrorInterceptor =
  (server: Server, requestId: RequestId): ErrorInterceptor =>
  (error, baseUrl) => {
    if (!isAxiosError(error) || !error.response) {
      log.error(
        server,
        `Response from request ${requestId} failed with error: ${getExceptionMessage(error)}`,
        { logger: 'rest-api', requestId },
      );
      return;
    }

    // The type for the AxiosResponse headers is complex and not directly assignable to that of the Axios response interceptor's.
    const { response } = error as { response: AxiosResponseInterceptorConfig };
    logResponse(
      server,
      {
        baseUrl,
        ...getResponseInterceptorConfig(response),
      },
      requestId,
    );
  };

function logRequest(server: Server, request: RequestInterceptorConfig, requestId: RequestId): void {
  const config = getConfig();
  const maskedRequest = config.disableLogMasking ? request : maskRequest(request);
  const url = new URL(maskedRequest.url ?? '', maskedRequest.baseUrl);
  const messageObj = {
    type: 'request',
    requestId,
    method: maskedRequest.method,
    url: url.toString(),
    ...(shouldLogWhenLevelIsAtLeast('debug') && {
      headers: maskedRequest.headers,
      data: maskedRequest.data,
      params: maskedRequest.params,
    }),
  } as const;

  log.info(server, messageObj, { logger: 'rest-api', requestId });
}

function logResponse(
  server: Server,
  response: ResponseInterceptorConfig,
  requestId: RequestId,
): void {
  const config = getConfig();
  const maskedResponse = config.disableLogMasking ? response : maskResponse(response);
  const url = new URL(maskedResponse.url ?? '', maskedResponse.baseUrl);
  const messageObj = {
    type: 'response',
    requestId,
    url: url.toString(),
    status: maskedResponse.status,
    ...(shouldLogWhenLevelIsAtLeast('debug') && {
      headers: maskedResponse.headers,
      data: maskedResponse.data,
    }),
  } as const;

  log.info(server, messageObj, { logger: 'rest-api', requestId });
}
