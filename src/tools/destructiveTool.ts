import { CallToolResult, ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import { ZodRawShape } from 'zod';

import { getConfig } from '../config.js';
import { log } from '../logging/log.js';
import { Tool, ToolParams } from './tool.js';

export type DestructiveToolParams<Args extends ZodRawShape | undefined = undefined> =
  ToolParams<Args> & {
    annotations: ToolAnnotations & {
      destructive?: true;
    };
  };

export class DestructiveTool<Args extends ZodRawShape | undefined = undefined> extends Tool<Args> {
  constructor(params: DestructiveToolParams<Args>) {
    super(params);
  }

  override logAndExecute = async <T>({
    args,
    callback,
  }: {
    args: unknown;
    callback: (requestId: string) => Promise<T>;
  }): Promise<CallToolResult> => {
    if (!getConfig().isDryRun) {
      return await this._logAndExecute({ args, callback });
    }

    this.logInvocation(args);
    log.debug('Dry run mode enabled, no changes will be made.');

    return {
      isError: false,
      content: [
        {
          type: 'text',
          text: 'Destructive update is complete.',
        },
      ],
    };
  };
}
