import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Err, Ok } from 'ts-results-es';

import { McpToolError } from '../../errors/mcpToolError.js';
import { Server } from '../../server.js';
import { Tool } from '../tool.js';

const paramsSchema = {};

/**
 * Revokes the Tableau-issued access token that the current MCP session is using.
 *
 * The token is derived from request context (`extra.tableauAuthInfo`) — the model
 * never sees or handles the raw token value.
 *
 * Supported auth modes:
 *   - Bearer (Tableau authZ server mode): revokes the Tableau JWT by posting to
 *     `${config.oauth.issuer}/oauth2/revoke`.
 *
 * Not supported:
 *   - X-Tableau-Auth (embedded authZ mode): the token stored in this context is a
 *     Tableau REST API session token (workgroup session ID), not an OAuth JWT. The
 *     correct invalidation path is `POST /auth/signout`, which has different
 *     semantics. Deferred until confirmed with the identity team.
 *   - Passthrough: session credentials are managed externally.
 */
export const getRevokeAccessTokenTool = (server: Server): Tool<typeof paramsSchema> => {
  const revokeAccessTokenTool = new Tool({
    server,
    name: 'revoke-access-token',
    description: `Revokes the Tableau access token used to authenticate the current MCP session.

After revocation the access token is immediately invalidated on the Tableau authorization server. Subsequent Tableau API calls within this session may fail. Clients should disconnect from the MCP server after calling this tool.

This tool does not require any input — it operates on the token already associated with the current session and never exposes the raw token value.

**When to use:**
- Signing a user out of the MCP session
- Revoking access after detecting suspicious activity
- Clean session teardown from an MCP client or orchestration layer

**Supported authentication modes:**
- Tableau authorization server mode (OAuth with Tableau Cloud or Tableau Server as the authorization server, i.e. Bearer token sessions)

**Not supported:**
- Embedded authorization server mode (embedded authZ / X-Tableau-Auth sessions — deferred, requires design confirmation)
- PAT (Personal Access Token) authentication
- Direct trust / UAT authentication
- Passthrough authentication`,
    paramsSchema,
    annotations: {
      title: 'Revoke Access Token',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    callback: async (_args, extra): Promise<CallToolResult> => {
      return revokeAccessTokenTool.logAndExecute<{ message: string }>({
        extra,
        args: {},
        callback: async () => {
          const { tableauAuthInfo, config, signal } = extra;

          if (!tableauAuthInfo) {
            return new Err(
              new McpToolError({
                type: 'not-supported',
                message:
                  'Access token revocation is only available when OAuth authentication is active. ' +
                  'This session is using a non-OAuth authentication method (e.g. PAT, direct trust, or UAT).',
                statusCode: 400,
              }),
            );
          }

          let token: string;
          let revokeUrl: string;

          if (tableauAuthInfo.type === 'Bearer') {
            // Tableau authZ server mode: the raw JWT is the Tableau-issued access token.
            // The revocation endpoint lives on the Tableau authorization server (config.oauth.issuer).
            token = tableauAuthInfo.raw;
            revokeUrl = `${config.oauth.issuer}/oauth2/revoke`;
          } else {
            // X-Tableau-Auth (embedded authZ): NOT supported here.
            //
            // In embedded authZ mode, tableauAuthInfo.accessToken is a Tableau REST API session
            // token (workgroup session ID, format: part0|part1|siteLuid|...), NOT an OAuth JWT.
            // The correct invalidation mechanism for a session token is POST /auth/signout via the
            // Tableau REST API, not an OAuth /oauth2/revoke call. Sending a session token to an
            // OAuth revocation endpoint would fail. Support for this mode is deferred until the
            // correct sign-out/revocation semantics are confirmed with the identity team.
            //
            // Passthrough and any future auth types are also not applicable.
            return new Err(
              new McpToolError({
                type: 'not-supported',
                message:
                  'Access token revocation is only supported in Tableau authorization server mode ' +
                  '(Bearer). Embedded authorization server mode and Passthrough auth are not ' +
                  'currently supported by this tool.',
                statusCode: 400,
              }),
            );
          }

          const response = await fetch(revokeUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token }),
            signal,
          });

          if (!response.ok) {
            // Do not include the response body in the error message to avoid leaking token details.
            return new Err(
              new McpToolError({
                type: 'revoke-failed',
                message: `The Tableau authorization server rejected the revocation request (HTTP ${response.status}). The access token may already be expired or invalid.`,
                statusCode: response.status,
              }),
            );
          }

          return Ok({ message: 'Access token has been submitted for revocation. Subsequent Tableau API calls may fail.' });
        },
        constrainSuccessResult: (result) => ({ type: 'success', result }),
      });
    },
  });

  return revokeAccessTokenTool;
};
