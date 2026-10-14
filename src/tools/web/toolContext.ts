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
  getSiteName: () => string;
  getUserLuid: () => string;
  setSiteLuid?: (siteLuid: string) => void;
  setUserLuid?: (userLuid: string) => void;
  /**
   * Whether an MCP-Apps card can ACTUALLY render for THIS client this session — i.e. the `mcp-apps`
   * feature is enabled AND the client advertised the UI capability AND it is not a known-incompatible
   * renderer. Distinct from the global `mcp-apps` flag: a tool is registered as an app-tool only when
   * all three hold (see server.web.ts registerTools). Tools that return an app-shaped card in their
   * app path (e.g. delete-content) MUST key that decision on THIS signal, not on the flag alone —
   * otherwise a plain-registered-but-flag-on client receives an unrenderable app payload that
   * degrades to a raw JSON blob (W-24212898). Absent/false ⇒ fall back to a readable text result.
   */
  mcpAppToolsRenderable?: boolean;
};

// An extension of the RequestHandlerExtra type that includes the TableauWebToolContext
export type TableauWebRequestHandlerExtra = TableauWebToolContext & {
  config: Config;
} & RequestHandlerExtra<ServerRequest, ServerNotification>;

// An extension of ToolCallback that includes additional context in the extra parameter
export type TableauWebToolCallback<
  Args extends undefined | ZodRawShapeCompat | AnySchema = undefined,
> = TableauToolCallback<WebMcpServer, TableauWebRequestHandlerExtra, Args>;
