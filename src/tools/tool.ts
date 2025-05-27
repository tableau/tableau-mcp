import { randomUUID } from 'node:crypto';

import { ToolCallback } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CallToolResult, ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import { Err, Ok, Result } from 'ts-results-es';
import { ZodRawShape } from 'zod';

import { getToolLogMessage, log } from '../logging/log.js';
import { getExceptionMessage } from '../utils/getExceptionMessage.js';
import { ToolName } from './toolName.js';

export type ToolParams<Args extends ZodRawShape | undefined = undefined> = {
  name: ToolName;
  description: string;
  paramsSchema: Args;
  annotations: ToolAnnotations;
  callback: ToolCallback<Args>;
};

export class Tool<Args extends ZodRawShape | undefined = undefined> {
  name: ToolName;
  description: string;
  paramsSchema: Args;
  annotations: ToolAnnotations;
  callback: ToolCallback<Args>;

  constructor({ name, description, paramsSchema, annotations, callback }: ToolParams<Args>) {
    this.name = name;
    this.description = description;
    this.paramsSchema = paramsSchema;
    this.annotations = annotations;
    this.callback = callback;
  }

  logInvocation(args: unknown): void {
    log.debug(getToolLogMessage(this.name, args));
  }

  logAndExecute = async <T>({
    args,
    callback,
  }: {
    args: unknown;
    callback: (requestId: string) => Promise<T>;
  }): Promise<CallToolResult> => {
    return await this._logAndExecute({ args, callback });
  };

  protected _logAndExecute = async <T>({
    args,
    callback,
  }: {
    args: unknown;
    callback: (requestId: string) => Promise<T>;
  }): Promise<CallToolResult> => {
    this.logInvocation(args);

    const result = await getResult(callback);

    if (result.isOk()) {
      return {
        isError: false,
        content: [
          {
            type: 'text',
            text: JSON.stringify(result.value),
          },
        ],
      };
    }

    return {
      isError: true,
      content: [
        {
          type: 'text',
          text: result.error.message,
        },
      ],
    };
  };
}

async function getResult<T>(
  callback: (requestId: string) => Promise<T>,
): Promise<Result<T, Error>> {
  const requestId = randomUUID();

  try {
    return Ok(await callback(requestId));
  } catch (error) {
    if (error instanceof Error) {
      return Err(error);
    }

    return Err(new Error(`requestId: ${requestId}, error: ${getExceptionMessage(error)}`));
  }
}
