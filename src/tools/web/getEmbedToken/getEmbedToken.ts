import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Err, Ok } from 'ts-results-es';

import { EmbedTokenNotAvailableError } from '../../../errors/mcpToolError.js';
import { getFeatureGate } from '../../../features/featureGate.js';
import { buildAuthConfig } from '../../../sdks/tableau/buildAuthConfig.js';
import { WebMcpServer } from '../../../server.web.js';
import { WebTool } from '../tool.js';
import { EMBED_SCOPE, resolveEmbedToken } from './resolveEmbedToken.js';

const paramsSchema = {};

/**
 * Returns an embed token (a Tableau-signed JWT) used to authenticate the embedded
 * Tableau viz in the MCP app UI. Resolves the token from whatever signing material
 * the current server configuration provides:
 *   - a passed-through Tableau Bearer JWT (AUTH=oauth, Tableau authZ server), or
 *   - an embed JWT signed on the server (AUTH=direct-trust or AUTH=uat).
 * When no material is available the tool reports not-available and the app skips
 * embedding. The token value is never exposed to the model.
 */
export const getEmbedTokenTool = (server: WebMcpServer): WebTool<typeof paramsSchema> => {
  const getEmbedTokenTool = new WebTool({
    server,
    name: 'get-embed-token',
    description: `Returns an embed token (a Tableau-signed JWT) used to authenticate the embedded Tableau viz in the app UI.

This tool resolves the embed token from the current session's signing material — a passed-through Tableau Bearer JWT, or an embed JWT signed on the server under direct-trust or uat. It requires no input and is only visible to the app, never the model. If no token is available for the current configuration, it reports that and the app falls back to a non-embedded view.`,
    paramsSchema,
    annotations: {
      title: 'Get Embed Token',
      readOnlyHint: true,
      openWorldHint: false,
    },
    meta: {
      ui: {
        visibility: ['app'], // Only visible to the app, not the model
      },
    },
    disabled: !getFeatureGate().isFeatureEnabled('mcp-apps'),
    callback: async (_args, extra): Promise<CallToolResult> => {
      return getEmbedTokenTool.logAndExecute<{ token: string; tokenType: string }>({
        extra,
        args: {},
        callback: async () => {
          const { config, tableauAuthInfo } = extra;

          // 1. Bearer pass-through: if tableauAuthInfo is a Bearer JWT, use it directly.
          if (tableauAuthInfo?.type === 'Bearer') {
            return Ok({ token: tableauAuthInfo.raw, tokenType: 'Bearer' });
          }

          // 2. Otherwise: build an AuthConfig and let the resolver sign an embed token.
          const authConfig = buildAuthConfig({
            config,
            tableauAuthInfo,
            scopes: new Set([EMBED_SCOPE]),
          });

          if (!authConfig) {
            // No AuthConfig available (oauth without Bearer, or other unsupported scenario)
            return new EmbedTokenNotAvailableError().toErr();
          }

          const result = await resolveEmbedToken({ authConfig });
          if (result.isErr()) {
            return new EmbedTokenNotAvailableError().toErr();
          }

          return Ok({ token: result.value.token, tokenType: 'Bearer' });
        },
        constrainSuccessResult: (result) => ({ type: 'success', result }),
      });
    },
  });

  return getEmbedTokenTool;
};
