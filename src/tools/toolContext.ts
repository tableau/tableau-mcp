import {
  AuthInfo,
  CallToolResult,
  Notification,
  RequestId,
  RequestMeta,
  ServerContext,
  StandardSchemaWithJSON,
} from '@modelcontextprotocol/server';
import { z, ZodRawShape } from 'zod';

import { Server } from '../server.js';

// Tools declare either a raw zod shape or a full schema; the registration adapters wrap raw shapes
// in z.object() because the SDK only takes raw shapes through a deprecated overload.
export type ToolParamsSchema = ZodRawShape | StandardSchemaWithJSON;

export type ToolArgs<Args extends undefined | ToolParamsSchema> = Args extends ZodRawShape
  ? z.output<z.ZodObject<Args>>
  : Args extends StandardSchemaWithJSON
    ? StandardSchemaWithJSON.InferOutput<Args>
    : undefined;

export function toStandardSchema(
  schema: ToolParamsSchema | undefined,
): StandardSchemaWithJSON | undefined {
  if (schema === undefined || '~standard' in schema) {
    return schema as StandardSchemaWithJSON | undefined;
  }
  return z.object(schema);
}

// Additional context available to all tool callbacks
export type TableauToolContext<TServer extends Server> = {
  server: TServer;
};

// The per-request fields tools read. Kept flat so tool code doesn't track the SDK's context shape;
// the registration adapters fill them from ServerContext via getRequestFields.
export type TableauRequestFields = {
  signal: AbortSignal;
  requestId: RequestId;
  sessionId?: string;
  authInfo?: AuthInfo;
  requestInfo?: { headers: Headers };
  _meta?: RequestMeta;
  sendNotification: (notification: Notification) => Promise<void>;
  sendRequest: ServerContext['mcpReq']['send'];
};

export function getRequestFields(ctx: ServerContext): TableauRequestFields {
  return {
    signal: ctx.mcpReq.signal,
    requestId: ctx.mcpReq.id,
    sessionId: ctx.sessionId,
    authInfo: ctx.http?.authInfo,
    requestInfo: ctx.http?.req ? { headers: ctx.http.req.headers } : undefined,
    _meta: ctx.mcpReq._meta,
    sendNotification: ctx.mcpReq.notify,
    sendRequest: ctx.mcpReq.send,
  };
}

export type TableauRequestHandlerExtra<TServer extends Server> = TableauToolContext<TServer> &
  TableauRequestFields;

export type TableauToolCallback<
  TServer extends Server,
  TExtra extends TableauRequestHandlerExtra<TServer>,
  Args extends undefined | ToolParamsSchema = undefined,
> = Args extends ToolParamsSchema
  ? (args: ToolArgs<Args>, extra: TExtra) => CallToolResult | Promise<CallToolResult>
  : (extra: TExtra) => CallToolResult | Promise<CallToolResult>;
