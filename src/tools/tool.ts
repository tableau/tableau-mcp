import { AnySchema, ZodRawShapeCompat } from '@modelcontextprotocol/sdk/server/zod-compat.js';
import { CallToolResult, RequestId, ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import { Result } from 'ts-results-es';
import { z, ZodRawShape, ZodTypeAny } from 'zod';

import { McpToolError } from '../errors/mcpToolError.js';
import { getNotificationMessageForTool, notifier } from '../logging/notification.js';
import { Server } from '../server.js';
import { TypeOrProvider } from '../utils/provider.js';
import { TableauRequestHandlerExtra, TableauToolCallback } from './toolContext.js';
import { ToolName } from './toolName.js';

/**
 * The parameters for creating a tool instance
 *
 * @typeParam Args - The schema of the tool's parameters
 */
export type ToolParams<
  TServer extends Server,
  TToolName extends ToolName,
  TCallback extends TableauToolCallback<Args>,
  Args extends undefined | ZodRawShapeCompat | AnySchema,
> = {
  // The MCP server instance
  server: TServer;

  // The name of the tool
  name: TToolName;

  // The description of the tool
  description: TypeOrProvider<string>;

  // The schema of the tool's parameters
  paramsSchema: TypeOrProvider<Args>;

  // The annotations of the tool
  annotations: TypeOrProvider<ToolAnnotations>;

  // The implementation of the tool itself
  callback: TypeOrProvider<TCallback>;

  // When true, the tool is not registered with the MCP server (model never sees it)
  disabled?: TypeOrProvider<boolean>;
};

/**
 * The parameters the logAndExecute method
 *
 * @typeParam T - The type of the result the tool's implementation returns
 * @typeParam TToolContext - The type of the tool context
 * @typeParam Args - The schema of the tool's parameters
 */
export type LogAndExecuteParams<
  T,
  TExtra extends TableauRequestHandlerExtra,
  Args extends undefined | ZodRawShapeCompat | AnySchema,
> = {
  // The extra data provided to request handlers
  extra: TExtra;

  // The arguments of the tool call
  args: Args extends ZodRawShape ? z.objectOutputType<Args, ZodTypeAny> : undefined;

  // A function that contains the business logic of the tool to be logged and executed
  callback: () => Promise<Result<T, McpToolError>>;

  // A function that can transform a successful result of the callback into a CallToolResult
  getSuccessResult?: (result: T) => CallToolResult;
};

/**
 * Represents an MCP tool
 *
 * @template Args - The schema of the tool's parameters or undefined if the tool has no parameters
 */
export abstract class Tool<
  TServer extends Server,
  TToolName extends ToolName,
  TCallback extends TableauToolCallback<Args>,
  Args extends ZodRawShape | undefined = undefined,
> {
  server: TServer;
  name: TToolName;
  description: TypeOrProvider<string>;
  paramsSchema: TypeOrProvider<Args>;
  annotations: TypeOrProvider<ToolAnnotations>;
  callback: TypeOrProvider<TCallback>;
  disabled: TypeOrProvider<boolean>;

  constructor({
    server,
    name,
    description,
    paramsSchema,
    annotations,
    callback,
    disabled,
  }: ToolParams<TServer, TToolName, TCallback, Args>) {
    this.server = server;
    this.name = name;
    this.description = description;
    this.paramsSchema = paramsSchema;
    this.annotations = annotations;
    this.callback = callback;
    this.disabled = disabled ?? false;
  }

  logInvocation({
    requestId,
    args,
    username,
  }: {
    requestId: RequestId;
    args: unknown;
    username?: string;
  }): void {
    notifier.debug(
      this.server,
      getNotificationMessageForTool({
        requestId,
        toolName: this.name,
        args,
        username,
      }),
    );
  }
}
