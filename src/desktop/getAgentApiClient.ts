import { getDesktopConfig } from '../config.desktop.js';
import { log } from '../logging/logger.js';
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
  const url = new URL(
    `${request.baseUrl.replace(/\/$/, '')}/${request.url?.replace(/^\//, '') ?? ''}`,
  );
  if (request.params && Object.keys(request.params).length > 0) {
    url.search = new URLSearchParams(request.params).toString();
  }

  log({
    message: 'Agent API request',
    level: 'debug',
    logger: 'AgentApiClient',
    data: {
      method: request.method,
      url: url.toString(),
      headers: request.headers,
      data: request.data,
    },
  });
}

function logResponse(response: ResponseInterceptorConfig): void {
  const url = new URL(
    `${response.baseUrl.replace(/\/$/, '')}/${response.url?.replace(/^\//, '') ?? ''}`,
  );
  if (response.params && Object.keys(response.params).length > 0) {
    url.search = new URLSearchParams(response.params).toString();
  }

  log({
    message: 'Agent API response',
    level: 'debug',
    logger: 'AgentApiClient',
    data: {
      status: response.status,
      url: url.toString(),
      headers: response.headers,
      data: response.data,
    },
  });
}
