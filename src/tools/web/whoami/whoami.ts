import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';

import { log } from '../../../logging/logger.js';
import { useRestApi } from '../../../restApiInstance.js';
import { WebMcpServer } from '../../../server.web.js';
import { WebTool } from '../tool.js';

const paramsSchema = {};

/**
 * The connection identity reported by the whoami tool.
 *
 * The context-derived fields (auth method, server, site name/luid, username, user luid)
 * are always present. The remaining fields are populated only when the live
 * `/sessions/current` lookup succeeds (`liveSessionVerified: true`).
 */
type WhoamiResult = {
  authMethod: string;
  credentialType?: string;
  server: string;
  site: {
    name?: string;
    luid?: string;
    contentUrl?: string;
  };
  user: {
    username?: string;
    luid?: string;
    fullName?: string;
    email?: string;
    siteRole?: string;
  };
  liveSessionVerified: boolean;
};

/**
 * Reports where the current MCP session is connected: the authentication method,
 * Tableau server, site, and authorized user.
 *
 * Hybrid data source:
 *   - Context (always available, never fails): auth method, server, site name/luid,
 *     username, user luid — derived from config + the request's auth info.
 *   - Live enrichment (best effort): a `GET /sessions/current` call adds the
 *     authoritative site (name, contentUrl) and user (fullName, email, siteRole).
 *
 * If the live lookup fails the tool still succeeds, returning the context-derived
 * facts with `liveSessionVerified: false`.
 */
export const getWhoamiTool = (server: WebMcpServer): WebTool<typeof paramsSchema> => {
  const whoamiTool = new WebTool({
    server,
    name: 'whoami',
    description: `Reports where the current session is connected to Tableau: the authentication method, server, site, and authorized user.

Use this tool to confirm the active connection — for example when a user asks "where am I connected?", "which Tableau site is this?", or "who am I signed in as?".

This tool requires no input. It always reports the configured connection details (auth method, server, site, user) and, when available, enriches them with live details from the current Tableau session (full name, email, site role). The \`liveSessionVerified\` field indicates whether the live session lookup succeeded.`,
    paramsSchema,
    annotations: {
      title: 'Who Am I',
      readOnlyHint: true,
      openWorldHint: false,
    },
    callback: async (_args, extra): Promise<CallToolResult> => {
      return whoamiTool.logAndExecute<WhoamiResult>({
        extra,
        args: {},
        callback: async () => {
          const { config, tableauAuthInfo } = extra;

          // Context block — always available, never fails.
          const result: WhoamiResult = {
            authMethod: config.auth,
            credentialType: tableauAuthInfo?.type,
            server: config.server || tableauAuthInfo?.server || '',
            site: {
              name: extra.getSiteName() || undefined,
              luid: extra.getSiteLuid() || undefined,
            },
            user: {
              username: tableauAuthInfo?.username || undefined,
              luid: extra.getUserLuid() || undefined,
            },
            liveSessionVerified: false,
          };

          // Best-effort enrichment from the live Tableau session. A failure here
          // (REST error or thrown exception) must never fail the tool.
          try {
            await useRestApi({
              ...extra,
              jwtScopes: whoamiTool.requiredApiScopes,
              callback: async (restApi) => {
                const sessionResult =
                  await restApi.authenticatedServerMethods.getCurrentServerSession();

                if (sessionResult.isErr()) {
                  log({
                    message: 'whoami: live session lookup returned an error',
                    level: 'debug',
                    logger: 'tool',
                    data: sessionResult.error,
                  });
                  return;
                }

                const { site, user } = sessionResult.value;
                result.site = {
                  name: site.name || result.site.name,
                  luid: site.id || result.site.luid,
                  contentUrl: site.contentUrl,
                };
                result.user = {
                  username: user.name || result.user.username,
                  luid: user.id || result.user.luid,
                  fullName: user.fullName,
                  email: user.email,
                  siteRole: user.siteRole,
                };
                result.liveSessionVerified = true;
              },
            });
          } catch (error) {
            log({
              message: 'whoami: live session lookup threw; returning context-only info',
              level: 'debug',
              logger: 'tool',
              data: error,
            });
          }

          return Ok(result);
        },
        constrainSuccessResult: (result) => ({ type: 'success', result }),
      });
    },
  });

  return whoamiTool;
};
