import { Err, Ok, Result } from 'ts-results-es';

import { Config, getDesktopConfig } from '../../../config.desktop';
import { log } from '../../../logging/logger';
import { isAxiosError } from '../../../utils/axios';
import { getExceptionMessage } from '../../../utils/getExceptionMessage';
import {
  AxiosResponseInterceptorConfig,
  ErrorInterceptor,
  getRequestInterceptorConfig,
  getResponseInterceptorConfig,
  RequestInterceptor,
  RequestInterceptorConfig,
  ResponseInterceptor,
  ResponseInterceptorConfig,
} from '../../interceptors';
import { AgentApiClient } from '../agentApi/client';
import { GetCommandStatusResponse, GetEventsResponse } from '../agentApi/types';
import {
  ExecuteCommandArgs,
  ExecuteCommandError,
  GetEventsArgs,
  ToolExecutor,
} from './toolExecutor';

type LocalExecutorConfig = {
  agentApiBase: string;
  authToken?: string;
  commandTimeoutMs: number;
  pollIntervalMs: number;
};

const DEFAULT_CONFIG: LocalExecutorConfig = {
  agentApiBase: 'http://127.0.0.1:8765/api/v1',
  commandTimeoutMs: 300_000,
  pollIntervalMs: 1_000,
};

export class LocalExecutor extends ToolExecutor {
  private readonly config: LocalExecutorConfig;
  private readonly desktopConfig: Config;
  private readonly agentApiClient: AgentApiClient;

  constructor(config: Partial<LocalExecutorConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };

    this.desktopConfig = getDesktopConfig();
    this.agentApiClient = new AgentApiClient({
      baseUrl: this.config.agentApiBase,
      authToken: this.config.authToken,
      options: {
        maxRequestTimeoutMs: this.config.commandTimeoutMs,
        requestInterceptor: [this.getRequestInterceptor(), this.getRequestErrorInterceptor()],
        responseInterceptor: [this.getResponseInterceptor(), this.getResponseErrorInterceptor()],
      },
    });
  }

  async start(): Promise<void> {
    log(
      {
        message: 'LocalExecutor starting',
        level: 'info',
        logger: 'LocalExecutor',
        data: {
          agentApiBase: this.config.agentApiBase,
        },
      },
      this.desktopConfig,
    );
  }

  stop(): void {
    log(
      {
        message: 'LocalExecutor stopped',
        level: 'info',
        logger: 'LocalExecutor',
      },
      this.desktopConfig,
    );
  }

  isAvailable(): boolean {
    return true;
  }

  async executeCommand({
    command,
    namespace,
    args,
  }: ExecuteCommandArgs): Promise<Result<GetCommandStatusResponse, ExecuteCommandError>> {
    args ??= {};

    const executeResult = await this.agentApiClient.executeCommand({
      namespace,
      command,
      args,
    });

    if (executeResult.isErr()) {
      log(
        {
          message: `Failed to execute command ${namespace}.${command}. Reason: ${getExceptionMessage(executeResult.error)}`,
          level: 'error',
          logger: 'LocalExecutor',
          data: executeResult.error,
        },
        this.desktopConfig,
      );
      return Err({ type: 'unknown', error: executeResult.error });
    }

    const commandId = executeResult.value.command_id;
    const commandStatusResult = await this.waitForCommand(commandId);
    if (commandStatusResult.isErr()) {
      const error = commandStatusResult.error;
      log(
        {
          message:
            error.type === 'command-timed-out'
              ? `Command ${commandId} timed out`
              : `Failed to get status of command ${commandId}. Reason: ${getExceptionMessage(error)}`,
          level: 'error',
          logger: 'LocalExecutor',
          data: error,
        },
        this.desktopConfig,
      );

      return commandStatusResult;
    }

    const commandResult = commandStatusResult.value;
    if (commandResult.status === 'failed') {
      log(
        {
          message: `Command ${commandId} failed. Reason: ${getExceptionMessage(commandResult.error)}`,
          level: 'error',
          logger: 'LocalExecutor',
          data: commandResult.error,
        },
        this.desktopConfig,
      );
      return Err({ type: 'command-failed', error: commandResult.error });
    }

    return Ok(commandResult);
  }

  async getEvents({ sinceSequence }: GetEventsArgs): Promise<Result<GetEventsResponse, unknown>> {
    const getEventsResult = await this.agentApiClient.getEvents(sinceSequence);
    if (getEventsResult.isErr()) {
      const error = getEventsResult.error;
      log(
        {
          message: `Failed to get events. Reason: ${getExceptionMessage(error)}`,
          level: 'error',
          logger: 'LocalExecutor',
          data: error,
        },
        this.desktopConfig,
      );
    }

    return getEventsResult;
  }

  private async waitForCommand(
    commandId: string,
  ): Promise<Result<GetCommandStatusResponse, ExecuteCommandError>> {
    const maxAttempts = Math.ceil(this.config.commandTimeoutMs / this.config.pollIntervalMs);
    let attempts = 0;

    while (attempts < maxAttempts) {
      const commandStatusResult = await this.agentApiClient.getCommandStatus(commandId);
      if (commandStatusResult.isErr()) {
        return Err({ type: 'unknown', error: commandStatusResult.error });
      }

      const commandStatus = commandStatusResult.value;
      if (commandStatus.status === 'completed' || commandStatus.status === 'failed') {
        return Ok(commandStatus);
      }

      await new Promise((resolve) => setTimeout(resolve, this.config.pollIntervalMs));
      attempts++;
    }

    return Err({ type: 'command-timed-out' });
  }

  private getRequestInterceptor(): RequestInterceptor {
    return (request) => {
      this.logRequest(request);
      return request;
    };
  }

  private getRequestErrorInterceptor(): ErrorInterceptor {
    return (error, baseUrl) => {
      if (!isAxiosError(error) || !error.request) {
        log(
          {
            message: `Request failed with error: ${getExceptionMessage(error)}`,
            level: 'error',
            logger: 'LocalExecutor',
            data: { error },
          },
          this.desktopConfig,
        );
        return;
      }

      const { request } = error;
      this.logRequest({
        baseUrl,
        ...getRequestInterceptorConfig(request),
      });
    };
  }

  private getResponseInterceptor(): ResponseInterceptor {
    return (response) => {
      this.logResponse(response);
      return response;
    };
  }

  private getResponseErrorInterceptor(): ErrorInterceptor {
    return (error, baseUrl) => {
      if (!isAxiosError(error) || !error.response) {
        log(
          {
            message: `Response failed with error: ${getExceptionMessage(error)}`,
            level: 'error',
            logger: 'LocalExecutor',
            data: { error },
          },
          this.desktopConfig,
        );
        return;
      }

      const { response } = error as { response: AxiosResponseInterceptorConfig };
      this.logResponse({
        baseUrl,
        ...getResponseInterceptorConfig(response),
      });
    };
  }

  private logRequest(request: RequestInterceptorConfig): void {
    const url = new URL(
      `${request.baseUrl.replace(/\/$/, '')}/${request.url?.replace(/^\//, '') ?? ''}`,
    );
    if (request.params && Object.keys(request.params).length > 0) {
      url.search = new URLSearchParams(request.params).toString();
    }

    log(
      {
        message: 'Agent API request',
        level: 'debug',
        logger: 'LocalExecutor',
        data: {
          method: request.method,
          url: url.toString(),
          headers: request.headers,
          data: request.data,
          params: request.params,
        },
      },
      this.desktopConfig,
    );
  }

  private logResponse(response: ResponseInterceptorConfig): void {
    const url = new URL(
      `${response.baseUrl.replace(/\/$/, '')}/${response.url?.replace(/^\//, '') ?? ''}`,
    );
    if (response.params && Object.keys(response.params).length > 0) {
      url.search = new URLSearchParams(response.params).toString();
    }

    log(
      {
        message: 'Agent API response',
        level: 'debug',
        logger: 'LocalExecutor',
        data: {
          status: response.status,
          url: url.toString(),
          headers: response.headers,
          data: response.data,
        },
      },
      this.desktopConfig,
    );
  }
}
