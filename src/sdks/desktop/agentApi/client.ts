import { Zodios, ZodiosInstance } from '@zodios/core';
import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { Err, Ok, Result } from 'ts-results-es';

import {
  ErrorInterceptor,
  getRequestInterceptorConfig,
  getResponseInterceptorConfig,
  RequestInterceptor,
  ResponseInterceptor,
} from '../../interceptors';
import { agentApis } from './apis';
import {
  agentTokenSchema,
  ExecuteCommandRequest,
  ExecuteCommandResponse,
  GetCommandStatusResponse,
} from './types';

export class AgentApiClient {
  private readonly _apiClient: ZodiosInstance<typeof agentApis>;
  private readonly _authToken: string | undefined;
  private readonly _tokenPath: string;

  constructor({
    baseUrl,
    authToken,
    options,
  }: {
    baseUrl: string;
    authToken?: string;
    options: { maxRequestTimeoutMs: number } & Partial<{
      signal: AbortSignal;
      requestInterceptor: [RequestInterceptor, ErrorInterceptor?];
      responseInterceptor: [ResponseInterceptor, ErrorInterceptor?];
    }>;
  }) {
    this._authToken = authToken;

    this._tokenPath =
      process.platform === 'win32'
        ? join(process.env.LOCALAPPDATA ?? '', 'Tableau', 'Desktop', 'agent-token.txt')
        : join(homedir(), '.tableau', 'agent-token.txt');

    this._apiClient = new Zodios(baseUrl, agentApis, {
      axiosConfig: { timeout: options.maxRequestTimeoutMs, signal: options.signal },
    });

    this._apiClient.axios.interceptors.request.use(
      (config) => {
        options.requestInterceptor?.[0]({
          baseUrl,
          ...getRequestInterceptorConfig(config),
        });
        return config;
      },
      (error) => {
        options.requestInterceptor?.[1]?.(error, baseUrl);
        return Promise.reject(error);
      },
    );

    this._apiClient.axios.interceptors.response.use(
      (response) => {
        options.responseInterceptor?.[0]({
          baseUrl,
          ...getResponseInterceptorConfig(response),
        });
        return response;
      },
      (error) => {
        options.responseInterceptor?.[1]?.(error, baseUrl);
        return Promise.reject(error);
      },
    );
  }

  get headers(): { headers: { Authorization: `Bearer ${string}` } } | undefined {
    const authToken = this.getAuthToken();
    if (!authToken) {
      return;
    }

    return {
      headers: { Authorization: `Bearer ${authToken}` },
    };
  }

  async executeCommand(
    request: ExecuteCommandRequest,
  ): Promise<Result<ExecuteCommandResponse, unknown>> {
    try {
      return Ok(
        await this._apiClient.executeCommand(request, {
          ...this.headers,
        }),
      );
    } catch (error) {
      return Err(error);
    }
  }

  async getCommandStatus(commandId: string): Promise<Result<GetCommandStatusResponse, unknown>> {
    try {
      return Ok(
        await this._apiClient.getCommandStatus({
          params: { commandId },
          ...this.headers,
        }),
      );
    } catch (error) {
      return Err(error);
    }
  }

  async getHealth(): Promise<boolean> {
    try {
      const response = await this._apiClient.health({ ...this.headers });
      return response.status === 'healthy';
    } catch {
      return false;
    }
  }

  private getAuthToken(): string | undefined {
    if (this._authToken) {
      return this._authToken;
    }

    try {
      if (!existsSync(this._tokenPath)) {
        return undefined;
      }

      const tokenData = agentTokenSchema.parse(JSON.parse(readFileSync(this._tokenPath, 'utf-8')));
      return tokenData.token;
    } catch {
      return undefined;
    }
  }
}
