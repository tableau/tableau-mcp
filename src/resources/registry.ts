import { ReadResourceResult } from '@modelcontextprotocol/sdk/types.js';

import { Config } from '../config.js';
import { WebMcpServer } from '../server.web.js';

/**
 * A static MCP resource exposed by the server (e.g. a skill / guidance document).
 *
 * Modeled on the prompt registry in `src/prompts/registry.ts`. Resources are
 * app-controlled context data addressable by URI; clients read them on demand.
 */
export type WebResourceRegistration = {
  name: string;
  uri: string;
  title?: string;
  description: string;
  mimeType: string;
  // Returns true if the resource should be skipped for the current server config.
  disabled: (config: Config) => boolean;
  read: () => ReadResourceResult | Promise<ReadResourceResult>;
};

export type WebResourceFactory = (server: WebMcpServer) => WebResourceRegistration;
