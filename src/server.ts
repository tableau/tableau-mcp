import {
  McpServer,
  ReadResourceTemplateCallback,
  ResourceTemplate,
} from '@modelcontextprotocol/sdk/server/mcp.js';
import { ErrorCode, InitializeRequest, McpError } from '@modelcontextprotocol/sdk/types.js';
import { existsSync, readFileSync } from 'fs';

import { TableauAuthInfo } from './server/oauth/schemas.js';

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

  constructor({
    mcpServer,
    clientInfo,
    serverName,
    serverVersion,
  }: {
    mcpServer?: McpServer;
    clientInfo?: ClientInfo;
    serverName: string;
    serverVersion: string;
  }) {
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
            prompts: {},
          },
        },
      );

    this.name = serverName;
    this.version = serverVersion;
    this._clientInfo = clientInfo;
  }

  get userAgent(): string {
    const userAgentParts = [`${this.name}/${this.version}`];
    if (this.clientInfo) {
      const { name, version } = this.clientInfo;
      if (name) {
        userAgentParts.push(version ? `(${name} ${version})` : `(${name})`);
      }
    }
    return userAgentParts.join(' ');
  }

  abstract registerResources: () => Promise<void>;
  abstract registerTools: (tableauAuthInfo?: TableauAuthInfo) => Promise<void>;

  registerResource = (
    args:
      | {
          name: string;
          title: string;
          description: string;
          uri: string;
          path: string;
          mimeType: string;
        }
      | {
          name: string;
          title: string;
          description: string;
          uri: string;
          text: string;
          mimeType: string;
        }
      | {
          name: string;
          title: string;
          description: string;
          template: ResourceTemplate;
          readTemplateCallback: ReadResourceTemplateCallback;
        },
  ): void => {
    if ('text' in args) {
      const { name, title, description, uri, text, mimeType } = args;
      this.mcpServer.registerResource(name, uri, { title, description, mimeType }, (uri) => {
        return { contents: [{ uri: uri.href, mimeType, text }] };
      });
    } else if ('path' in args) {
      const { name, title, description, uri, path, mimeType } = args;
      if (!existsSync(path)) {
        throw new McpError(ErrorCode.InternalError, `File not found: ${path}`);
      }
      const text = readFileSync(path, 'utf-8');
      this.mcpServer.registerResource(name, uri, { title, description, mimeType }, (uri) => {
        return { contents: [{ uri: uri.href, mimeType, text }] };
      });
    } else {
      const { name, title, description, template, readTemplateCallback } = args;
      this.mcpServer.registerResource(
        name,
        template,
        {
          title,
          description,
        },
        readTemplateCallback,
      );
    }
  };
}
