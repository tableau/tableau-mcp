import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Err, Ok } from 'ts-results-es';

import { getConfig } from '../../../config.js';
import { McpToolError } from '../../../errors/mcpToolError.js';
import { WebMcpServer } from '../../../server.web.js';
import invariant from '../../../utils/invariant.js';
import { WebTool } from '../tool.js';

const paramsSchema = {};

/**
 * Returns the OAuth Bearer token used to authenticate the current MCP session.
 *
 * The token is derived from request context — this tool retrieves and returns
 * the raw Tableau JWT Bearer token for use by the client application only.
 *
 * Supported auth modes:
 *   - Bearer (Tableau authZ server mode): returns the raw Tableau JWT.
 *
 * Not supported (returns runtime error):
 *   - X-Tableau-Auth (embedded mode): not a Bearer token.
 *   - Passthrough: not an OAuth token.
 *   - PAT mode: no OAuth token available.
 */
export const getOAuthTokenTool = (server: WebMcpServer): WebTool<typeof paramsSchema> => {
  const config = getConfig();

  const getOAuthTokenTool = new WebTool({
    server,
    name: 'get-oauth-token',
    description: `Returns the OAuth Bearer token (Tableau JWT) used to authenticate the current session.

This tool provides the raw Tableau JWT Bearer token associated with the current session for use by client applications. The token value is never exposed to the model.

This tool requires no input — it operates on the token already associated with the current session.

**When to use:**
- Retrieving the Tableau JWT Bearer token for client-side operations
- Obtaining the token for direct Tableau API calls from the client application
- Token inspection or validation by the client

**Important:** This tool only works with Bearer token authentication (Tableau OAuth server mode) and is not visible to the model.`,
    paramsSchema,
    annotations: {
      title: 'Get OAuth Token',
      readOnlyHint: true,
      openWorldHint: false,
    },
    meta: {
      ui: {
        visibility: ['app'], // Only visible to the app, not the model
      },
    },
    disabled: config.auth !== 'oauth',
    callback: async (_args, extra): Promise<CallToolResult> => {
      return getOAuthTokenTool.logAndExecute<{ token: string; tokenType: string }>({
        extra,
        args: {},
        callback: async () => {
          const { tableauAuthInfo } = extra;
          invariant(tableauAuthInfo, 'tableauAuthInfo must be set in OAuth mode');

          if (tableauAuthInfo.type !== 'Bearer') {
            // Only Bearer tokens (Tableau OAuth JWT) are supported.
            return new Err(
              new McpToolError({
                type: 'not-supported',
                message:
                  'OAuth Bearer token retrieval is only available for Bearer authentication (Tableau OAuth server mode). ' +
                  `Current auth type: ${tableauAuthInfo.type}`,
                statusCode: 400,
              }),
            );
          }

          // Tableau authZ server mode: return the raw Tableau JWT Bearer token.
          const token = tableauAuthInfo.raw;
          const tokenType = 'Bearer';

          return Ok({ token, tokenType });
        },
        constrainSuccessResult: (result) => ({ type: 'success', result }),
      });
    },
  });

  return getOAuthTokenTool;
};
