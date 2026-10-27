import { BaseToolCallback } from '@modelcontextprotocol/sdk/experimental';
import { AnySchema, ZodRawShapeCompat } from '@modelcontextprotocol/sdk/server/zod-compat.js';
import { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import {
  CallToolResult,
  ServerNotification,
  ServerRequest,
} from '@modelcontextprotocol/sdk/types.js';

import { Config } from '../../config.desktop.js';
import { CallDeadline } from '../../desktop/callDeadline.js';
import { ExternalApiToolExecutor } from '../../desktop/externalApi/externalApiToolExecutor.js';
import { DesktopMcpServer } from '../../server.desktop.js';
import { TableauToolContext } from '../toolContext.js';

// Additional context available to all desktop tool callbacks
export type TableauDesktopToolContext = TableauToolContext<DesktopMcpServer> & {
  config: Config;
  getExecutor: (sessionId: string) => Promise<ExternalApiToolExecutor>;
  /**
   * The per-call clock. `extra.signal` is already composed with it, so a tool that forwards
   * `extra.signal` gets the deadline for free; `logAndExecute` races it so a tool that ignores
   * the signal still returns the honest timeout instead of hanging.
   */
  deadline?: CallDeadline;
};

// An extension of the RequestHandlerExtra type that includes the TableauDesktopToolContext
export type TableauDesktopRequestHandlerExtra = TableauDesktopToolContext &
  RequestHandlerExtra<ServerRequest, ServerNotification>;

// An extension of ToolCallback that includes additional context in the extra parameter
export type TableauDesktopToolCallback<
  Args extends undefined | ZodRawShapeCompat | AnySchema = undefined,
> = BaseToolCallback<CallToolResult, TableauDesktopRequestHandlerExtra, Args>;
