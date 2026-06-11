import { getDesktopConfig } from '../config.desktop.js';
import { getBaseConfig } from '../config.shared.js';
import { log } from '../logging/logger.js';
import { sanitizeValue } from '../logging/sanitize.js';
import { maskRequest, maskResponse } from '../logging/secretMask.js';
import { AgentApiClient } from '../sdks/desktop/agentApi/client.js';
import {
  ErrorInterceptor,
  getRequestInterceptorConfig,
  getResponseInterceptorConfig,
  RequestInterceptor,
  RequestInterceptorConfig,
  ResponseInterceptor,
  ResponseInterceptorConfig,
} from '../sdks/interceptors.js';
import { isAxiosError } from '../utils/axios.js';

export type AgentApiClientConfig = {
  agentApiBase: string;
  authToken?: string;
  commandTimeoutMs: number;
  pollIntervalMs: number;
};

export async function getAgentApiClient({
  signal,
  config,
}: {
  signal: AbortSignal;
  config?: Partial<AgentApiClientConfig>;
}): Promise<AgentApiClient> {
  const mergedConfig = { ...getDesktopConfig().agentApiClientConfig, ...config };
  return new AgentApiClient({
    baseUrl: mergedConfig.agentApiBase,
    authToken: mergedConfig.authToken,
    options: {
      maxRequestTimeoutMs: mergedConfig.commandTimeoutMs,
      signal,
      requestInterceptor: [getRequestInterceptor(), getRequestErrorInterceptor()],
      responseInterceptor: [getResponseInterceptor(), getResponseErrorInterceptor()],
    },
  });
}

export const getRequestInterceptor = (): RequestInterceptor => (request) => {
  logRequest(request);
  return request;
};

export const getRequestErrorInterceptor = (): ErrorInterceptor => (error, baseUrl) => {
  if (!isAxiosError(error) || !error.request) {
    log({
      message: 'Request failed',
      level: 'error',
      logger: 'AgentApiClient',
      data: error,
    });
    return;
  }

  logRequest({
    baseUrl,
    ...getRequestInterceptorConfig(error.request),
  });
};

export const getResponseInterceptor = (): ResponseInterceptor => (response) => {
  logResponse(response);
  return response;
};

export const getResponseErrorInterceptor = (): ErrorInterceptor => (error, baseUrl) => {
  if (!isAxiosError(error) || !error.response) {
    log({
      message: 'Response failed',
      level: 'error',
      logger: 'AgentApiClient',
      data: error,
    });
    return;
  }

  logResponse({
    baseUrl,
    ...getResponseInterceptorConfig(error.response),
  });
};

function logRequest(request: RequestInterceptorConfig): void {
  const config = getBaseConfig();
  const maskedRequest = config.disableLogMasking ? request : maskRequest(request);

  const url = new URL(
    `${maskedRequest.baseUrl.replace(/\/$/, '')}/${maskedRequest.url?.replace(/^\//, '') ?? ''}`,
  );
  if (maskedRequest.params && Object.keys(maskedRequest.params).length > 0) {
    url.search = new URLSearchParams(maskedRequest.params).toString();
  }
  const data = {
    method: maskedRequest.method,
    url: url.toString(),
    headers: maskedRequest.headers,
    params: maskedRequest.params,
    data: sanitize(maskedRequest.data),
  } as const;

  log({
    message: 'Agent API request',
    level: 'debug',
    logger: 'AgentApiClient',
    data,
  });
}

function logResponse(response: ResponseInterceptorConfig): void {
  const config = getBaseConfig();
  const maskedResponse = config.disableLogMasking ? response : maskResponse(response);
  const url = new URL(
    `${maskedResponse.baseUrl.replace(/\/$/, '')}/${maskedResponse.url?.replace(/^\//, '') ?? ''}`,
  );
  if (maskedResponse.params && Object.keys(maskedResponse.params).length > 0) {
    url.search = new URLSearchParams(maskedResponse.params).toString();
  }

  const data = {
    url: url.toString(),
    status: maskedResponse.status,
    headers: maskedResponse.headers,
    data: sanitize(maskedResponse.data),
  } as const;

  log({
    message: 'Agent API response',
    level: 'debug',
    logger: 'AgentApiClient',
    data,
  });
}

function sanitize(value: unknown): unknown {
  return sanitizeValue(value, {
    seen: new WeakSet<object>(),
    depth: 0,
  });
}
