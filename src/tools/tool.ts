import { randomUUID } from 'node:crypto';

import { ToolCallback } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Err, Ok, Result } from 'ts-results-es';
import { ZodRawShape } from 'zod';

export type ToolParams<Args extends ZodRawShape | undefined = undefined> = {
  name: string;
  description: string;
  paramsSchema: Args;
  callback: ToolCallback<Args>;
};

export class Tool<Args extends ZodRawShape | undefined = undefined> {
  name: string;
  description: string;
  paramsSchema: Args;
  callback: ToolCallback<Args>;

  constructor({ name, description, paramsSchema, callback }: ToolParams<Args>) {
    this.name = name;
    this.description = description;
    this.paramsSchema = paramsSchema;
    this.callback = callback;
  }
}

export async function getToolCallback<T>(
  callback: (requestId: string) => Promise<T>,
): Promise<CallToolResult> {
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
}

async function getResult<T>(
  callback: (requestId: string) => Promise<T>,
): Promise<Result<T, Error>> {
  const requestId = randomUUID();

  try {
    return Ok(await callback(requestId));
  } catch (error) {
    return Err(
      error instanceof Error ? error : new Error(`requestId: ${requestId}, error: ${error}`),
    );
  }
}
