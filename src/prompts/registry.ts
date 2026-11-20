import { GetPromptResult } from '@modelcontextprotocol/sdk/types.js';
import { z, ZodRawShape } from 'zod';

import { Config } from '../config.js';
import { WebMcpServer } from '../server.web.js';

export type WebPromptRegistration<Args extends ZodRawShape = ZodRawShape> = {
  name: string;
  title?: string;
  description: string;
  argsSchema?: Args;
  // Returns (or resolves to) true if the prompt should be skipped for the current server config.
  disabled: (config: Config) => boolean | Promise<boolean>;
  callback: (
    // Factories type against the wide ZodRawShape; zod 4 infers that as {}, so keep v3's loose args.
    args: ZodRawShape extends Args
      ? Record<string, any>
      : Args extends ZodRawShape
        ? z.output<z.ZodObject<Args>>
        : Record<string, never>,
  ) => GetPromptResult | Promise<GetPromptResult>;
};

export type WebPromptFactory = (server: WebMcpServer) => WebPromptRegistration;
