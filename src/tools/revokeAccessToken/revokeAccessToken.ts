import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Err, Ok } from 'ts-results-es';

import { getConfig } from '../../config.js';
import { McpToolError } from '../../errors/mcpToolError.js';
import { WebMcpServer } from '../../server.web.js';
import invariant from '../../utils/invariant.js';
import { WebTool } from '../tool.web.js';

const paramsSchema = {};

/**
 * Revokes the access token used to authenticate the current MCP session.
 *
 * The token is derived from request context — the model never sees or handles
 * the raw token value.
 *
 * Supported auth modes:
 *   - Bearer (Tableau authZ server mode): posts the raw Tableau JWT to
 *     `${config.oauth.issuer}/oauth2/revoke` on the Tableau authorization server.
 *   - X-Tableau-Auth (embedded authZ mode): posts the raw MCP JWE access token to
 *     the local embedded revocation endpoint (`${config.oauth.issuer}/oauth2/revoke`),
 *     which decrypts it, calls Tableau's `/auth/signout`, and deletes the associated
 *     refresh token from the server.
 *
 * Not supported (returns runtime error):
 *   - Passthrough: session credentials are managed externally.
 */
export const getRevokeAccessTokenTool = (server: WebMcpServer): WebTool<typeof paramsSchema> => {
  const config = getConfig();

  const revokeAccessTokenTool = new WebTool({
    server,
    name: 'revoke-access-token',
    description: `Revokes the access token used to authenticate the current session.

After revocation the session is invalidated. Subsequent Tableau API calls within this session may fail. Clients should disconnect from the MCP server after calling this tool.

This tool requires no input — it operates on the token already associated with the current session and never exposes the raw token value.

**When to use:**
- Signing a user out of the MCP session
- Revoking access after detecting suspicious activity
- Clean session teardown from an MCP client or orchestration layer`,
    paramsSchema,
    annotations: {
      title: 'Revoke Access Token',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    disabled: config.auth !== 'oauth',
    callback: async (_args, extra): Promise<CallToolResult> => {
      return revokeAccessTokenTool.logAndExecute<string>({
        extra,
        args: {},
        callback: async () => {
          const { tableauAuthInfo, config: extraConfig, signal } = extra;
          invariant(tableauAuthInfo, 'tableauAuthInfo must be set in OAuth mode');

          let token: string;
          let revokeUrl: string;

          if (tableauAuthInfo.type === 'Bearer') {
            // Tableau authZ server mode: the raw Tableau JWT is the access token.
            token = tableauAuthInfo.raw;
            revokeUrl = `${extraConfig.oauth.issuer}/oauth2/revoke`;
          } else if (tableauAuthInfo.type === 'X-Tableau-Auth') {
            // Embedded authZ mode: submit the raw MCP JWE access token to the local
            // revocation endpoint, which handles decryption, signout, and cleanup.
            const rawMcpToken = extra.authInfo?.token;
            invariant(rawMcpToken, 'authInfo.token must be set in OAuth mode');
            token = rawMcpToken;
            revokeUrl = `${extraConfig.oauth.issuer}/oauth2/revoke`;
          } else {
            // Passthrough: session credentials are managed externally.
            // (Other future auth types are also not applicable.)
            return new Err(
              new McpToolError({
                type: 'not-supported',
                message:
                  'Access token revocation is not available for Passthrough authentication. ' +
                  'Session credentials are managed externally.',
                statusCode: 400,
              }),
            );
          }

          let response: Response;
          if (tableauAuthInfo.type === 'Bearer') {
            const clientId = tableauAuthInfo.clientId;
            if (!clientId) {
              return new Err(
                new McpToolError({
                  type: 'not-supported',
                  message:
                    'Access token revocation is not available: the OAuth client_id required by the authorization server could not be determined from the current session context.',
                  statusCode: 400,
                }),
              );
            }
            const params = new URLSearchParams({ token, client_id: clientId });
            response = await fetch(revokeUrl, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                Accept: 'application/json',
              },
              body: params.toString(),
              signal,
            });
          } else {
            // Embedded authZ server parses JSON (express.json() middleware).
            response = await fetch(revokeUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ token, token_type_hint: 'access_token' }),
              signal,
            });
          }

          if (!response.ok) {
            return new Err(
              new McpToolError({
                type: 'revoke-failed',
                message: `The authorization server rejected the revocation request (HTTP ${response.status}). The access token may already be expired or invalid.`,
                statusCode: response.status,
              }),
            );
          }

          return Ok(
            'Access token has been submitted for revocation. Subsequent Tableau API calls may fail.',
          );
        },
        constrainSuccessResult: (result) => ({ type: 'success', result }),
      });
    },
  });

  return revokeAccessTokenTool;
};
