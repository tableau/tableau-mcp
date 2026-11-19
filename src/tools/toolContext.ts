import { BaseToolCallback, CallToolResult, ServerContext } from '@modelcontextprotocol/server';
import { Server } from '../server.js';

// Additional context available to all tool callbacks
export type TableauToolContext<TServer extends Server> = {
  server: TServer;
};

// An extension of the RequestHandlerExtra type that includes the TableauToolContext
export type TableauRequestHandlerExtra<TServer extends Server> = TableauToolContext<TServer> &
  ServerContext;

// An extension of ToolCallback that includes additional context in the extra parameter
export type TableauToolCallback<
  TServer extends Server,
  TExtra extends TableauRequestHandlerExtra<TServer>,
  Args extends undefined | ZodRawShapeCompat | AnySchema = undefined,
> = BaseToolCallback<CallToolResult, TExtra, Args>;
