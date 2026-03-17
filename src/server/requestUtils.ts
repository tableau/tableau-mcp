import { CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';

import { isToolName, ToolName } from '../tools/toolName.js';

/**
 * Extract tool names from a JSON-RPC request body.
 * Handles both single requests and batched request arrays.
 */
export function getToolNameFromRequestBody(body: unknown): ToolName | undefined {
  const callToolRequestResult = CallToolRequestSchema.safeParse(body);

  if (callToolRequestResult.success) {
    const { name } = callToolRequestResult.data.params;
    if (isToolName(name)) {
      return name;
    }
  }
  return undefined;
}
