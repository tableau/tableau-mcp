import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { InitializeRequest, SetLevelRequestSchema } from '@modelcontextprotocol/sdk/types.js';

import pkg from '../package.json';
import { setNotificationLevel } from './logging/notification.js';
import { TableauAuthInfo } from './server/oauth/schemas.js';

export const serverName = 'tableau-mcp';
export const serverVersion = pkg.version;
export const userAgent = `${serverName}/${serverVersion}`;

export type ClientInfo = InitializeRequest['params']['clientInfo'];

export abstract class Server {
  readonly mcpServer: McpServer;
  readonly name: string;
  readonly version: string;

  // Note that the McpServer class does expose a (poorly named) "getClientVersion()" method that returns the client info,
  // but the value of the field it returns is only set during the initialization lifecycle request.
  //
  // With HTTP transport, we create a new instance of the Server class for *each* request, so we store the client info
  // provided by the client in its initialization lifecycle request in the session store,
  // and pass it to the constructor with each post-initialization request.
  //
  // With stdio transport, we can use the getClientVersion() method to get the client info.
  private readonly _clientInfo: ClientInfo | undefined;

  get clientInfo(): ClientInfo | undefined {
    return this._clientInfo ?? this.mcpServer.server.getClientVersion();
  }

  constructor({ mcpServer, clientInfo }: { mcpServer?: McpServer; clientInfo?: ClientInfo } = {}) {
    this.mcpServer =
      mcpServer ??
      new McpServer(
        {
          name: serverName,
          version: serverVersion,
        },
        {
          capabilities: {
            logging: {},
            tools: {},
          },
        },
      );

    this.name = serverName;
    this.version = serverVersion;
    this._clientInfo = clientInfo;
  }

  abstract registerTools: (tableauAuthInfo?: TableauAuthInfo) => Promise<void>;

  registerRequestHandlers = (): void => {
    this.mcpServer.server.setRequestHandler(SetLevelRequestSchema, async (request) => {
      setNotificationLevel(this, request.params.level);
      return {};
    });
  };
}
