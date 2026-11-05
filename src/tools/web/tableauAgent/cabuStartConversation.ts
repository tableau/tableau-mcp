import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';

import { UnknownError } from '../../../errors/mcpToolError.js';
import { useRestApi } from '../../../restApiInstance.js';
import { luidSchema } from '../../../sdks/routeSafety/ids.js';
import { Localization } from '../../../sdks/tableau/types/cabu.js';
import { SiteRole } from '../../../sdks/tableau/types/user.js';
import { WebMcpServer } from '../../../server.web.js';
import { WebTool } from '../tool.js';
import { getCabuConversationStore } from './cabuConversationStore.js';
import { encodeUtteranceArgs } from './cabuUtteranceArgs.js';

const paramsSchema = {
  datasourceLuid: luidSchema,
};

// CABU's utterance endpoint requires a `localization` on every turn, but `cabu-start-conversation`
// has no caller-supplied locale to pass through -- see spec Non-goals ("locale negotiation is out
// of scope for the PDS-only demo"). English is a safe, fixed default for the demo.
const DEFAULT_LOCALIZATION: Localization = { locale: 'en-US', language: 'en' };

export const getCabuStartConversationTool = (
  server: WebMcpServer,
): WebTool<typeof paramsSchema> => {
  const cabuStartConversationTool = new WebTool({
    server,
    name: 'cabu-start-conversation',
    minRequiredRole: SiteRole.VIEWER,
    description: `
Starts a new conversation with CABU (Tableau Agent's natural-language Q&A over a published data source), scoped to one data source. Use \`search-content\` or \`list-datasources\` first to find the \`datasourceLuid\` of the data source you want to ask about.

Returns a \`conversationId\` and an opaque \`utteranceArgs\` token. Pass BOTH of these, unmodified, to every \`cabu-ask\` call that continues this conversation -- \`utteranceArgs\` is required on every turn, not just the first.

**Parameters:**

- \`datasourceLuid\` (required): The LUID of the published data source to start a CABU conversation about.
`,
    paramsSchema,
    annotations: {
      title: 'Start CABU Conversation',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    callback: async ({ datasourceLuid }, extra): Promise<CallToolResult> => {
      return await cabuStartConversationTool.logAndExecute<{
        conversationId: string;
        utteranceArgs: string;
      }>({
        extra,
        args: { datasourceLuid },
        callback: async () => {
          return await useRestApi({
            ...extra,
            jwtScopes: cabuStartConversationTool.requiredApiScopes,
            callback: async (restApi) => {
              const { response, cookies } = await restApi.cabuMethods.startConversation({
                dashboardDatasources: [{ datasourceLuid }],
                embedded: false,
              });

              if (!response.conversationId) {
                return new UnknownError(
                  'CABU did not return a conversationId for this conversation.',
                ).toErr();
              }

              const utteranceArgs = encodeUtteranceArgs({
                scope: response.scope,
                datasources: response.datasources ?? [],
                localization: DEFAULT_LOCALIZATION,
                embedded: false,
              });

              getCabuConversationStore().set(response.conversationId, { cookies, utteranceArgs });

              return new Ok({ conversationId: response.conversationId, utteranceArgs });
            },
          });
        },
        constrainSuccessResult: (result) => ({ type: 'success', result }),
      });
    },
  });

  return cabuStartConversationTool;
};
