import { GetPromptResult } from '@modelcontextprotocol/sdk/types.js';
import { z, ZodRawShape } from 'zod';

import { Config } from '../config.js';
import { WebMcpServer } from '../server.web.js';

export type WebPromptRegistration<Args extends ZodRawShape = ZodRawShape> = {
  name: string;
  title?: string;
  description: string;
  argsSchema?: Args;
  // Returns true if the prompt should be skipped for the current server config.
  disabled: (config: Config) => boolean;
  callback: (
    args: Args extends ZodRawShape ? z.objectOutputType<Args, z.ZodTypeAny> : Record<string, never>,
  ) => GetPromptResult | Promise<GetPromptResult>;
};

export type WebPromptFactory = (server: WebMcpServer) => WebPromptRegistration;
