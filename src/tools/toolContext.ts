import {
  AuthInfo,
  CallToolResult,
  PROTOCOL_VERSION_META_KEY,
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

export function toStandardSchema<S extends ZodRawShape>(schema: S): z.ZodObject<S>;
export function toStandardSchema<S extends StandardSchemaWithJSON>(schema: S): S;
export function toStandardSchema(schema: ToolParamsSchema): StandardSchemaWithJSON;
export function toStandardSchema(
  schema: ToolParamsSchema | undefined,
): StandardSchemaWithJSON | undefined;
export function toStandardSchema(
  schema: ToolParamsSchema | undefined,
): StandardSchemaWithJSON | undefined {
  if (schema === undefined || '~standard' in schema) {
    return schema as StandardSchemaWithJSON | undefined;
  }
  return z.object(schema);
}

// The inputSchema the SDK's tools/list advertises; the SDK doesn't export its converter.
export function toInputJsonSchema(schema: StandardSchemaWithJSON | undefined): {
  type: 'object';
  [key: string]: unknown;
} {
  return schema
    ? { type: 'object', ...schema['~standard'].jsonSchema.input({ target: 'draft-2020-12' }) }
    : { type: 'object', properties: {} };
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
  protocolVersion?: string;
  _meta?: RequestMeta;
  sendNotification: ServerContext['mcpReq']['notify'];
};

export function getRequestFields(ctx: ServerContext): TableauRequestFields {
  const envelope = ctx.mcpReq.envelope;
  const protocolVersion =
    envelope && PROTOCOL_VERSION_META_KEY in envelope
      ? envelope[PROTOCOL_VERSION_META_KEY]
      : undefined;
  return {
    signal: ctx.mcpReq.signal,
    requestId: ctx.mcpReq.id,
    sessionId: ctx.sessionId,
    authInfo: ctx.http?.authInfo,
    requestInfo: ctx.http?.req ? { headers: ctx.http.req.headers } : undefined,
    protocolVersion: typeof protocolVersion === 'string' ? protocolVersion : undefined,
    _meta: ctx.mcpReq._meta,
    sendNotification: ctx.mcpReq.notify,
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
