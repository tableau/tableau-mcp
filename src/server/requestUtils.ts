import { CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';

import { isToolName, WebToolName } from '../tools/toolName.web.js';

/**
 * Extract tool name from a JSON-RPC request body.
 */
export function getToolNameFromRequestBody(body: unknown): WebToolName | undefined {
  const callToolRequestResult = CallToolRequestSchema.safeParse(body);

  if (callToolRequestResult.success) {
    const { name } = callToolRequestResult.data.params;
    if (isToolName(name)) {
      return name;
    }
  }
}
