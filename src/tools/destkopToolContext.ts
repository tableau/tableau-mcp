import { BaseToolCallback } from '@modelcontextprotocol/sdk/experimental';
import { AnySchema, ZodRawShapeCompat } from '@modelcontextprotocol/sdk/server/zod-compat.js';
import { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import {
  CallToolResult,
  ServerNotification,
  ServerRequest,
} from '@modelcontextprotocol/sdk/types.js';

import { TableauToolContext } from './toolContext.js';

// Additional context available to all desktop tool callbacks
export type TableauDesktopToolContext = TableauToolContext;

// An extension of the RequestHandlerExtra type that includes the TableauDesktopToolContext
export type TableauDesktopRequestHandlerExtra = TableauDesktopToolContext &
  RequestHandlerExtra<ServerRequest, ServerNotification>;

// An extension of ToolCallback that includes additional context in the extra parameter
export type TableauDesktopToolCallback<
  Args extends undefined | ZodRawShapeCompat | AnySchema = undefined,
> = BaseToolCallback<CallToolResult, TableauDesktopRequestHandlerExtra, Args>;
