import { BaseToolCallback } from '@modelcontextprotocol/sdk/experimental';
import { AnySchema, ZodRawShapeCompat } from '@modelcontextprotocol/sdk/server/zod-compat.js';
import { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import {
  CallToolResult,
  ServerNotification,
  ServerRequest,
} from '@modelcontextprotocol/sdk/types.js';

import { Config } from '../config';
import { OverridableConfig } from '../overridableConfig';
import { Server } from '../server';
import { TableauAuthInfo } from '../server/oauth/schemas';

export type TableauToolContext = {
  config: Config;
  server: Server;
  tableauAuthInfo: TableauAuthInfo | undefined;
};

export type TableauRequestHandlerExtra = TableauToolContext &
  RequestHandlerExtra<ServerRequest, ServerNotification> & {
    getConfigWithOverrides: () => Promise<OverridableConfig>;
  };

export type TableauToolCallback<
  Args extends undefined | ZodRawShapeCompat | AnySchema = undefined,
> = BaseToolCallback<CallToolResult, TableauRequestHandlerExtra, Args>;
