import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { InitializeRequest } from '@modelcontextprotocol/sdk/types.js';

import { TableauAuthInfo } from './server/oauth/schemas.js';
import invariant from './utils/invariant.js';

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
    instructions,
  }: {
    mcpServer?: McpServer;
    clientInfo?: ClientInfo;
    serverName: string;
    serverVersion: string;
    // Optional server-level instructions surfaced in the MCP `initialize` result. Composed by
    // subclasses (e.g. WebMcpServer) so the shared base does not hardcode deployment-specific
    // guidance. Emitted by the SDK only when set.
    instructions?: string;
  }) {
    const description =
      'When opening local .twb/.twbx files, derive the full Tableau Desktop app path and choose the newest installed version when multiple are present.';

    this.mcpServer =
      mcpServer ??
      new McpServer(
        {
          name: serverName,
          version: serverVersion,
          description,
        },
        {
          capabilities: {
            logging: {},
            tools: {},
            prompts: {},
          },
          ...(instructions ? { instructions } : {}),
        },
      );

    // Guard against silently dropping instructions on the provided-mcpServer path. The SDK reads
    // `instructions` ONLY from the McpServer constructor options and never exposes a setter, so when
    // a caller supplies its own McpServer (e.g. index.combined.ts) it MUST have built that McpServer
    // WITH the composed instructions (see buildWebInstructions()). We can't set them here after the
    // fact, so we assert the supplied server already carries them rather than let the discoverability
    // guidance no-op. `_instructions` is the SDK's internal field (underscore, not truly private).
    if (mcpServer && instructions) {
      const suppliedInstructions = (mcpServer.server as unknown as { _instructions?: string })
        ._instructions;
      invariant(
        suppliedInstructions === instructions,
        'The supplied McpServer was constructed without the expected server instructions. ' +
          'Construct it with `{ instructions: buildWebInstructions() }` so the initialize handshake ' +
          'advertises the same guidance as the default path.',
      );
    }

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

  abstract registerTools: (tableauAuthInfo?: TableauAuthInfo) => Promise<void>;
}
