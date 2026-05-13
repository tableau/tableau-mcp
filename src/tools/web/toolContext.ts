import { AnySchema, ZodRawShapeCompat } from '@modelcontextprotocol/sdk/server/zod-compat.js';
import { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import { ServerNotification, ServerRequest } from '@modelcontextprotocol/sdk/types.js';

import { Config } from '../../config.js';
import { OverridableConfig } from '../../overridableConfig.js';
import { WebMcpServer } from '../../server.web.js';
import { TableauAuthInfo } from '../../server/oauth/schemas.js';
import { TableauToolCallback, TableauToolContext } from '../toolContext.js';

// Additional context available to all web tool callbacks
export type TableauWebToolContext = TableauToolContext<WebMcpServer> & {
  _userLuid?: string;
  _siteLuid?: string;

  tableauAuthInfo: TableauAuthInfo | undefined;
  getConfigWithOverrides: () => Promise<OverridableConfig>;
  getSiteLuid: () => string;
  getUserLuid: () => string;
  setSiteLuid?: (siteLuid: string) => void;
  setUserLuid?: (userLuid: string) => void;
};

// An extension of the RequestHandlerExtra type that includes the TableauWebToolContext
export type TableauWebRequestHandlerExtra = TableauWebToolContext & {
  config: Config;
} & RequestHandlerExtra<ServerRequest, ServerNotification>;

// An extension of ToolCallback that includes additional context in the extra parameter
export type TableauWebToolCallback<
  Args extends undefined | ZodRawShapeCompat | AnySchema = undefined,
> = TableauToolCallback<WebMcpServer, TableauWebRequestHandlerExtra, Args>;
