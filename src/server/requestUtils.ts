import { CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { Request } from 'express';

import { isToolName, ToolName } from '../tools/toolName.js';

export function getCookie(req: Request, cookieName: string): string {
  const cookieValue = req.cookies?.[cookieName];
  return cookieValue?.toString() ?? '';
}

export function getHeader(req: Request, headerName: string): string {
  const headerValue = req.headers[headerName];
  return headerValue?.toString() ?? '';
}

/**
 * Extract tool name from a JSON-RPC request body.
 */
export function getToolNameFromRequestBody(body: unknown): ToolName | undefined {
  const callToolRequestResult = CallToolRequestSchema.safeParse(body);

  if (callToolRequestResult.success) {
    const { name } = callToolRequestResult.data.params;
    if (isToolName(name)) {
      return name;
    }
  }
}
