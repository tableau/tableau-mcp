import { CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';

import { isWebToolName, WebToolName } from '../tools/web/toolName.js';

/**
 * Extract tool name from a JSON-RPC request body.
 */
export function getToolNameFromRequestBody(body: unknown): WebToolName | undefined {
  const callToolRequestResult = CallToolRequestSchema.safeParse(body);

  if (callToolRequestResult.success) {
    const { name } = callToolRequestResult.data.params;
    if (isWebToolName(name)) {
      return name;
    }
  }
}
