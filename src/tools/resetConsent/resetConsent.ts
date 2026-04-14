import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Err, Ok } from 'ts-results-es';

import { getConfig } from '../../config.js';
import { McpToolError } from '../../errors/mcpToolError.js';
import { Server } from '../../server.js';
import invariant from '../../utils/invariant.js';
import { Tool } from '../tool.js';

const paramsSchema = {};

/**
 * Resets saved OAuth consent for the current user on the Tableau authorization server.
 *
 * The token is derived from request context — the model never sees or handles
 * the raw token value.
 *
 * Supported auth modes:
 *   - Bearer (Tableau authZ server mode): posts to `${config.oauth.issuer}/oauth2/resetConsent`
 *     with the access token in the Authorization header. The current session remains valid.
 *
 * Not supported (returns runtime error):
 *   - X-Tableau-Auth (embedded authZ): the embedded authorization server has no consent model.
 *   - Passthrough: session credentials are managed externally.
 *
 * Important: call this tool BEFORE revoking the access token, since revocation
 * invalidates the token required to authenticate the reset consent request.
 */
export const getResetConsentTool = (server: Server): Tool<typeof paramsSchema> => {
  const config = getConfig();

  const resetConsentTool = new Tool({
    server,
    name: 'reset-consent',
    description: `Resets saved OAuth consent for the current user on the Tableau authorization server.

After resetting consent, the current MCP session remains valid. The next OAuth authorization flow will re-prompt the user for consent.

This tool requires no input — it operates on the token already associated with the current session and never exposes the raw token value.

**Important:** Call this tool before revoking the access token. Revocation invalidates the token required to authenticate the consent reset request.

**When to use:**
- Clearing previously granted consent as part of session teardown
- Resetting consent state during testing or development
- Cleaning up OAuth grants when a user's access should be fully removed`,
    paramsSchema,
    annotations: {
      title: 'Reset Consent',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    disabled: config.auth !== 'oauth',
    callback: async (_args, extra): Promise<CallToolResult> => {
      return resetConsentTool.logAndExecute<string>({
        extra,
        args: {},
        callback: async () => {
          const { tableauAuthInfo, config: extraConfig, signal } = extra;
          invariant(tableauAuthInfo, 'tableauAuthInfo must be set in OAuth mode');

          if (tableauAuthInfo.type === 'Bearer') {
            const token = tableauAuthInfo.raw;
            const resetConsentUrl = `${extraConfig.oauth.issuer}/oauth2/resetConsent`;

            const response = await fetch(resetConsentUrl, {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${token}`,
              },
              signal,
            });

            if (!response.ok) {
              return new Err(
                new McpToolError({
                  type: 'reset-consent-failed',
                  message: `The authorization server rejected the reset consent request (HTTP ${response.status}).`,
                  statusCode: response.status,
                }),
              );
            }

            return Ok(
              'Consent has been reset. The next authorization flow will re-prompt for consent.',
            );
          }

          if (tableauAuthInfo.type === 'X-Tableau-Auth') {
            return new Err(
              new McpToolError({
                type: 'not-supported',
                message:
                  'Consent reset is not available for the embedded authorization server. ' +
                  'The embedded authorization server does not maintain a consent model.',
                statusCode: 400,
              }),
            );
          }

          // Passthrough or any other auth type
          return new Err(
            new McpToolError({
              type: 'not-supported',
              message:
                'Consent reset is not available for Passthrough authentication. ' +
                'Session credentials are managed externally.',
              statusCode: 400,
            }),
          );
        },
        constrainSuccessResult: (result) => ({ type: 'success', result }),
      });
    },
  });

  return resetConsentTool;
};
