import {
  ReadResourceTemplateCallback,
  ResourceTemplate,
} from '@modelcontextprotocol/sdk/server/mcp.js';
import { ReadResourceResult } from '@modelcontextprotocol/sdk/types.js';

import { WebMcpServer } from '../server.web.js';

export type WebResourceRegistration = {
  name: string;
  uri: string;
  title: string;
  description: string;
  mimeType: 'text/markdown';
  read: () => ReadResourceResult | Promise<ReadResourceResult>;
};

export type WebResourceFactory = (server: WebMcpServer) => WebResourceRegistration;

/**
 * A dynamic (URI-template) resource. Unlike a static resource, its read callback receives the
 * server-verified request `extra` and the filled-in URI-template variables, so the handler can
 * derive an actor scope from authenticated/session context rather than trusting caller input.
 */
export type WebTemplateResourceRegistration = {
  name: string;
  template: ResourceTemplate;
  title: string;
  description: string;
  mimeType?: string;
  read: ReadResourceTemplateCallback;
};

export type WebTemplateResourceFactory = (server: WebMcpServer) => WebTemplateResourceRegistration;
