import { RequestId } from '@modelcontextprotocol/sdk/types.js';

import { Config, getConfig } from './config.js';
import { notifier, shouldNotifyWhenLevelIsAtLeast } from './logging/notification.js';
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
import { RestApi } from './sdks/tableau/restApi.js';
import { Server } from './server.js';
import { TableauAuthInfo } from './server/oauth/schemas.js';
import { TableauWebRequestHandlerExtra } from './tools/web/toolContext.js';
import { isAxiosError } from './utils/axios.js';
import { getExceptionMessage } from './utils/getExceptionMessage.js';
import invariant from './utils/invariant.js';

type JwtScopes =
  | 'tableau:viz_data_service:read'
  | 'tableau:content:read'
  | 'tableau:insight_definitions_metrics:read'
  | 'tableau:insight_metrics:read'
  | 'tableau:metric_subscriptions:read'
  | 'tableau:insights:read'
  | 'tableau:views:download'
  | 'tableau:insight_brief:create'
  | 'tableau:mcp_site_settings:read';

export type RestApiArgs = Pick<
  TableauWebRequestHandlerExtra,
  'config' | 'server' | 'signal' | 'tableauAuthInfo' | 'setSiteLuid' | 'setUserLuid'
> &
  (
    | {
        requestId: RequestId;
        disableLogging?: false;
      }
    | {
        disableLogging: true;
      }
  );

const getNewRestApiInstanceAsync = async (
  args: RestApiArgs & {
    jwtScopes: Set<JwtScopes>;
  },
): Promise<{ restApi: RestApi; signOutWhenCompleted: boolean }> => {
  const {
    config,
    server,
    jwtScopes,
    signal,
    tableauAuthInfo,
    disableLogging,
    setSiteLuid,
    setUserLuid,
  } = args;

  if (!disableLogging) {
    const { requestId } = args;
    signal.addEventListener(
      'abort',
      () => {
        notifier.info(
          server,
          {
            type: 'request-cancelled',
            requestId,
            reason: signal.reason,
          },
          { notifier: server.name, requestId },
        );
      },
      { once: true },
    );
  }

  const tableauServer = config.server || tableauAuthInfo?.server;
  invariant(tableauServer, 'Tableau server could not be determined');

  const restApi = new RestApi({
    maxRequestTimeoutMs: config.maxRequestTimeoutMs,
    signal,
    requestInterceptor: disableLogging
      ? undefined
      : [
          getRequestInterceptor(server, args.requestId),
          getRequestErrorInterceptor(server, args.requestId),
        ],
    responseInterceptor: disableLogging
      ? undefined
      : [
          getResponseInterceptor(server, args.requestId),
          getResponseErrorInterceptor(server, args.requestId),
        ],
  });

  let signOutWhenCompleted = true;
  if (tableauAuthInfo?.type === 'Passthrough') {
    if (!tableauAuthInfo.raw || !tableauAuthInfo.userId) {
      throw new Error('Auth info is required when not signing in first.');
    }

    signOutWhenCompleted = false;
    restApi.setCredentials(tableauAuthInfo.raw, tableauAuthInfo.userId);
  } else {
    if (config.auth === 'pat') {
      await restApi.signIn({
        type: 'pat',
        patName: config.patName,
        patValue: config.patValue,
        siteName: config.siteName,
      });
      setSiteLuid?.(restApi.siteId);
      setUserLuid?.(restApi.userId);
    } else if (config.auth === 'direct-trust') {
      await restApi.signIn({
        type: 'direct-trust',
        siteName: config.siteName,
        username: getJwtUsername(config, tableauAuthInfo),
        clientId: config.connectedAppClientId,
        secretId: config.connectedAppSecretId,
        secretValue: config.connectedAppSecretValue,
        scopes: jwtScopes,
        additionalPayload: getJwtAdditionalPayload(config, tableauAuthInfo),
      });
      setSiteLuid?.(restApi.siteId);
      setUserLuid?.(restApi.userId);
    } else if (config.auth === 'uat') {
      await restApi.signIn({
        type: 'uat',
        siteName: config.siteName,
        username: getJwtUsername(config, tableauAuthInfo),
        tenantId: config.uatTenantId,
        issuer: config.uatIssuer,
        usernameClaimName: config.uatUsernameClaimName,
        privateKey: config.uatPrivateKey,
        keyId: config.uatKeyId,
        scopes: jwtScopes,
        additionalPayload: getJwtAdditionalPayload(config, tableauAuthInfo),
      });
      setSiteLuid?.(restApi.siteId);
      setUserLuid?.(restApi.userId);
    } else if (config.auth === 'oauth') {
      invariant(tableauAuthInfo, 'Tableau auth info not provided.');

      signOutWhenCompleted = false;
      if (tableauAuthInfo?.type === 'Bearer') {
        restApi.setBearerToken(tableauAuthInfo.raw);
      } else if (tableauAuthInfo?.type === 'X-Tableau-Auth') {
        if (!tableauAuthInfo?.accessToken || !tableauAuthInfo?.userId) {
          throw new Error('Auth info is required when not signing in first.');
        }

        restApi.setCredentials(tableauAuthInfo.accessToken, tableauAuthInfo.userId);
      } else {
        throw new Error('Auth info is required when not signing in first.');
      }
    }
  }

  return { restApi, signOutWhenCompleted };
};

export const useRestApi = async <T>(
  args: RestApiArgs & {
    jwtScopes: ReadonlyArray<JwtScopes>;
    callback: (restApi: RestApi) => Promise<T>;
  },
): Promise<T> => {
  const { callback, ...remaining } = args;
  const { restApi, signOutWhenCompleted } = await getNewRestApiInstanceAsync({
    ...remaining,
    jwtScopes: new Set(args.jwtScopes),
  });
  try {
    return await callback(restApi);
  } finally {
    if (signOutWhenCompleted) {
      // Tableau REST sessions for 'pat' and 'direct-trust' are intentionally ephemeral.
      // Sessions for 'oauth' and 'passthrough' are not. Signing out would invalidate the session,
      // preventing the access token from being reused for subsequent requests.
      await restApi.signOut();
    }
  }
};

export const getRequestInterceptor =
  (server: Server, requestId: RequestId): RequestInterceptor =>
  (request) => {
    request.headers['User-Agent'] = getUserAgent(server);
    logRequest(server, request, requestId);
    return request;
  };

export const getRequestErrorInterceptor =
  (server: Server, requestId: RequestId): ErrorInterceptor =>
  (error, baseUrl) => {
    if (!isAxiosError(error) || !error.request) {
      notifier.error(
        server,
        `Request ${requestId} failed with error: ${getExceptionMessage(error)}`,
        {
          notifier: 'rest-api',
          requestId,
        },
      );
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
      notifier.error(
        server,
        `Response from request ${requestId} failed with error: ${getExceptionMessage(error)}`,
        { notifier: 'rest-api', requestId },
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
  const url = new URL(
    `${maskedRequest.baseUrl.replace(/\/$/, '')}/${maskedRequest.url?.replace(/^\//, '') ?? ''}`,
  );
  if (request.params && Object.keys(request.params).length > 0) {
    url.search = new URLSearchParams(request.params).toString();
  }

  const messageObj = {
    type: 'request',
    requestId,
    method: maskedRequest.method,
    url: url.toString(),
    ...(shouldNotifyWhenLevelIsAtLeast('debug') && {
      headers: maskedRequest.headers,
      data: maskedRequest.data,
      params: maskedRequest.params,
    }),
  } as const;

  notifier.info(server, messageObj, { notifier: 'rest-api', requestId });
}

function logResponse(
  server: Server,
  response: ResponseInterceptorConfig,
  requestId: RequestId,
): void {
  const config = getConfig();
  const maskedResponse = config.disableLogMasking ? response : maskResponse(response);
  const url = new URL(
    `${maskedResponse.baseUrl.replace(/\/$/, '')}/${maskedResponse.url?.replace(/^\//, '') ?? ''}`,
  );
  if (response.params && Object.keys(response.params).length > 0) {
    url.search = new URLSearchParams(response.params).toString();
  }
  const messageObj = {
    type: 'response',
    requestId,
    url: url.toString(),
    status: maskedResponse.status,
    ...(shouldNotifyWhenLevelIsAtLeast('debug') && {
      headers: maskedResponse.headers,
      data: maskedResponse.data,
    }),
  } as const;

  notifier.info(server, messageObj, { notifier: 'rest-api', requestId });
}

function getUserAgent(server: Server): string {
  const userAgentParts = [server.userAgent];
  if (server.clientInfo) {
    const { name, version } = server.clientInfo;
    if (name) {
      userAgentParts.push(version ? `(${name} ${version})` : `(${name})`);
    }
  }
  return userAgentParts.join(' ');
}

function getJwtUsername(config: Config, authInfo: TableauAuthInfo | undefined): string {
  return config.jwtUsername.replaceAll('{OAUTH_USERNAME}', authInfo?.username ?? '');
}

function getJwtAdditionalPayload(
  config: Config,
  authInfo: TableauAuthInfo | undefined,
): Record<string, unknown> {
  const json = config.jwtAdditionalPayload.replaceAll('{OAUTH_USERNAME}', authInfo?.username ?? '');
  return JSON.parse(json || '{}');
}
