import { CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { Request } from 'express';

import { isRequestOverridableVariable } from '../overridableConfig.js';
import { isWebToolName, WebToolName } from '../tools/web/toolName.js';

export const X_TABLEAU_MCP_CONFIG_HEADER = 'x-tableau-mcp-config';

export function getCookie(req: Request, cookieName: string): string {
  const cookieValue = req.cookies?.[cookieName];
  return cookieValue?.toString() ?? '';
}

export function getHeader(req: Request, headerName: string): string {
  const headerValue = req.headers[headerName];
  return headerValue?.toString() ?? '';
}

/**
 * Parses the request override header into a record
 * that maps request overridable variables to their override values.
 */
export function getRequestOverridesFromHeader(
  requestOverrideHeader: string,
): Record<string, string> {
  const requestOverrides: Record<string, string> = {};
  if (!requestOverrideHeader) {
    return requestOverrides;
  }

  requestOverrideHeader.split('&').forEach((overrideString) => {
    const [key, value] = overrideString.split('=');
    if (isRequestOverridableVariable(key)) {
      if (value === undefined) {
        throw new Error(
          `'${X_TABLEAU_MCP_CONFIG_HEADER}' header does not provide a value for '${key}'`,
        );
      }
      requestOverrides[key] = value;
    } else {
      throw new Error(`'${X_TABLEAU_MCP_CONFIG_HEADER}' header is invalid`);
    }
  });

  return requestOverrides;
}

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
