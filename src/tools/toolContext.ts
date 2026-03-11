import { BaseToolCallback } from '@modelcontextprotocol/sdk/experimental';
import { AnySchema, ZodRawShapeCompat } from '@modelcontextprotocol/sdk/server/zod-compat.js';
import { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import {
  CallToolResult,
  ServerNotification,
  ServerRequest,
} from '@modelcontextprotocol/sdk/types.js';

import { Config } from '../config.js';
import { OverridableConfig } from '../overridableConfig.js';
import { Server } from '../server.js';
import { TableauAuthInfo } from '../server/oauth/schemas.js';

// Additional context  available to all tool callbacks
export type TableauToolContext = {
  _userLuid?: string;
  _siteLuid?: string;

  config: Config;
  server: Server;
  tableauAuthInfo: TableauAuthInfo | undefined;
  getConfigWithOverrides: () => Promise<OverridableConfig>;
  get siteLuid(): string;
  get userLuid(): string;
  setSiteLuid: (siteLuid: string) => void;
  setUserLuid: (userLuid: string) => void;
};

// An extension of the RequestHandlerExtra type that includes the TableauToolContext
export type TableauRequestHandlerExtra = TableauToolContext &
  RequestHandlerExtra<ServerRequest, ServerNotification>;

// An extension of ToolCallback that includes additional context in the extra parameter
export type TableauToolCallback<
  Args extends undefined | ZodRawShapeCompat | AnySchema = undefined,
> = BaseToolCallback<CallToolResult, TableauRequestHandlerExtra, Args>;
