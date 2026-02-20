import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from '@modelcontextprotocol/ext-apps/server';
import { CallToolResult, ReadResourceResult } from '@modelcontextprotocol/sdk/types.js';

import { pulseInsightBundleSchema } from '../sdks/tableau/types/pulse.js';
import { Server } from '../server.js';
import { getAppDetails } from './getAppDetails.js';

export function registerPulseRendererApp(server: Server): void {
  const { name, resourceUri, html } = getAppDetails('pulse-renderer');

  // Two-part registration: tool + resource, tied together by the resource URI.
  // Register a tool with UI metadata. When the host calls this tool, it reads
  // `_meta.ui.resourceUri` to know which resource to fetch and render as an
  // interactive UI.
  registerAppTool(
    server,
    name,
    {
      title: 'Render Pulse Insight',
      description:
        'Render a Pulse insight given an insight bundle. Use this tool to render a Pulse insight in a chat window.',
      inputSchema: { bundle: pulseInsightBundleSchema },
      _meta: { ui: { resourceUri } }, // Links this tool to its UI resource
    },
    async ({ bundle }): Promise<CallToolResult> => {
      return { content: [{ type: 'text', text: JSON.stringify(bundle) }] };
    },
  );

  // Register the resource, which returns the bundled HTML/JavaScript for the UI.
  registerAppResource(
    // @ts-expect-error -- harmless type mismatch in registerAppResource; ext-apps uses MCP SDK v1.25.2. Should go away when MCP SDK is updated.
    server,
    resourceUri,
    resourceUri,
    { mimeType: RESOURCE_MIME_TYPE },
    async (): Promise<ReadResourceResult> => {
      return {
        contents: [
          {
            uri: resourceUri,
            mimeType: RESOURCE_MIME_TYPE,
            text: html,
          },
        ],
      };
    },
  );
}
