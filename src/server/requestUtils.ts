import { CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';

import { isToolName, ToolName } from '../tools/toolName.js';

/**
 * Extract tool names from a JSON-RPC request body.
 * Handles both single requests and batched request arrays.
 */
export function getToolNamesFromRequestBody(body: unknown): ToolName[] {
  const requests = Array.isArray(body) ? body : [body];
  const toolNames = new Set<ToolName>();

  for (const request of requests) {
    const callToolRequestResult = CallToolRequestSchema.safeParse(request);
    if (!callToolRequestResult.success) {
      continue;
    }

    const { name } = callToolRequestResult.data.params;
    if (isToolName(name)) {
      toolNames.add(name);
    }
  }

  return Array.from(toolNames);
}
