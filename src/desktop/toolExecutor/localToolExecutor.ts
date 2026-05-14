import { Err, Ok, Result } from 'ts-results-es';
import { z } from 'zod';

import { getDesktopConfig } from '../../config.desktop.js';
import { log } from '../../logging/logger.js';
import { GetCommandStatusResponse, GetEventsResponse } from '../../sdks/desktop/agentApi/types.js';
import { AgentApiClientConfig, getAgentApiClient } from '../getAgentApiClient.js';
import {
  ExecuteCommandArgs,
  ExecuteCommandError,
  GetEventsArgs,
  ToolExecutor,
} from './toolExecutor.js';

export class LocalExecutor extends ToolExecutor {
  private readonly config: AgentApiClientConfig;

  constructor(config?: Partial<AgentApiClientConfig>) {
    super();
    this.config = { ...getDesktopConfig().agentApiClientConfig, ...config };
  }

  async start(): Promise<void> {
    log({
      message: 'LocalExecutor starting',
      level: 'info',
      logger: 'LocalExecutor',
      data: {
        agentApiBase: this.config.agentApiBase,
      },
    });
  }

  stop(): void {
    log({
      message: 'LocalExecutor stopped',
      level: 'info',
      logger: 'LocalExecutor',
    });
  }

  isAvailable(): boolean {
    return true;
  }

  async executeCommand<Z extends z.ZodTypeAny = z.ZodTypeAny>({
    command,
    namespace,
    args,
    schema,
  }: ExecuteCommandArgs<Z>): Promise<
    Result<GetCommandStatusResponse & { parsedResult?: z.infer<Z> }, ExecuteCommandError>
  > {
    args ??= {};

    const client = await getAgentApiClient(this.config);
    const executeResult = await client.executeCommand({ namespace, command, args });

    if (executeResult.isErr()) {
      log({
        message: `Failed to execute command ${namespace}:${command}`,
        level: 'error',
        logger: 'LocalExecutor',
        data: executeResult.error,
      });
      return Err({ type: 'unknown', error: executeResult.error });
    }

    const commandId = executeResult.value.command_id;
    const commandStatusResult = await this.waitForCommand(commandId);
    if (commandStatusResult.isErr()) {
      const error = commandStatusResult.error;
      log({
        message:
          error.type === 'command-timed-out'
            ? `Command ${commandId} timed out`
            : `Failed to get status of command ${commandId}`,
        level: 'error',
        logger: 'LocalExecutor',
        data: error,
      });

      return commandStatusResult;
    }

    const commandResult = commandStatusResult.value;
    if (commandResult.status === 'failed') {
      log({
        message: `Command ${commandId} failed`,
        level: 'error',
        logger: 'LocalExecutor',
        data: commandResult.error,
      });
      return Err({ type: 'command-failed', error: commandResult.error });
    }

    if (!schema) {
      return Ok(commandResult);
    }

    let commandResultObj: unknown;
    try {
      commandResultObj = JSON.parse(commandResult.result?.text ?? '{}');
    } catch (error) {
      log({
        message: 'Failed to JSON parse command result',
        level: 'error',
        logger: 'LocalExecutor',
        data: error,
      });
      return Err({ type: 'unknown', error });
    }

    const safeParsedResult = schema.safeParse(commandResultObj);
    if (!safeParsedResult.success) {
      log({
        message: `Failed to parse command result with schema ${schema.toString()}.`,
        level: 'error',
        logger: 'LocalExecutor',
        data: safeParsedResult.error,
      });
      return Err({ type: 'unknown', error: safeParsedResult.error });
    }

    return Ok({
      ...commandResult,
      ...{ parsedResult: safeParsedResult.data },
    });
  }

  async getEvents(args?: GetEventsArgs): Promise<Result<GetEventsResponse, unknown>> {
    const { sinceSequence } = args ?? {};

    const client = await getAgentApiClient(this.config);
    const getEventsResult = await client.getEvents(sinceSequence);
    if (getEventsResult.isErr()) {
      const error = getEventsResult.error;
      log({
        message: 'Failed to get events',
        level: 'error',
        logger: 'LocalExecutor',
        data: error,
      });
    }

    return getEventsResult;
  }

  private async waitForCommand(
    commandId: string,
  ): Promise<Result<GetCommandStatusResponse, ExecuteCommandError>> {
    const maxAttempts = Math.ceil(this.config.commandTimeoutMs / this.config.pollIntervalMs);
    let attempts = 0;

    const client = await getAgentApiClient(this.config);

    while (attempts < maxAttempts) {
      const commandStatusResult = await client.getCommandStatus(commandId);

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
}
