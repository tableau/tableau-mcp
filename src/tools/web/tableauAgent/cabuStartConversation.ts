import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';

import { getConfig } from '../../../config.js';
import { DatasourceNotAllowedError, UnknownError } from '../../../errors/mcpToolError.js';
import { isTableauAgentToolsEnabled } from '../../../features/tableauAgentTools.js';
import { useRestApi } from '../../../restApiInstance.js';
import { luidSchema } from '../../../sdks/routeSafety/ids.js';
import { Localization } from '../../../sdks/tableau/types/cabu.js';
import { SiteRole } from '../../../sdks/tableau/types/user.js';
import { WebMcpServer } from '../../../server.web.js';
import { Provider } from '../../../utils/provider.js';
import { resourceAccessChecker } from '../resourceAccessChecker.js';
import { WebTool } from '../tool.js';
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
  const config = getConfig();
  const cabuStartConversationTool = new WebTool({
    server,
    name: 'cabu-start-conversation',
    disabled: new Provider(async () => !(await isTableauAgentToolsEnabled(config))),
    minRequiredRole: SiteRole.VIEWER,
    description: `
Starts a new Tableau Agent conversation about one published data source. This tool is part of Tableau Agent: it uses CABU, Tableau Agent's natural-language Q&A service. Use \`search-content\` or \`list-datasources\` first to find the \`datasourceLuid\` of the data source you want to ask about.

**Tableau Agent answers with its own LLM.** Questions asked in this conversation (through \`cabu-ask\`) are sent to Tableau Agent. The LLM that backs Tableau Agent, not you, interprets each question, decides how to query the data, and writes the answer. When you pass an answer on to the user, say that it came from Tableau Agent.

**When to use:** only when the user explicitly opts in to Tableau Agent, for example "ask Tableau Agent...", "use Tableau Agent for this", or "use CABU". The user must ask for Tableau Agent by name or clearly ask to hand the question to Tableau's own agent. Never call this tool on your own initiative: a data question, even a complex one, is not an opt-in, and neither is the fact that this tool is available.

**When NOT to use:**
- For ordinary questions about the data in a data source (totals, breakdowns, top-N, trends, filters) when the user has not opted in. Answer those with \`get-datasource-metadata\` and \`query-datasource\`; they are the default way to query data.
- To continue a conversation that is already open. Once the user has opted in and this tool has started a conversation for a data source, send every follow-up question about that data source to \`cabu-ask\` with the same \`conversationId\` and \`utteranceArgs\`. Call this tool again only if the user asks to start over, or explicitly asks Tableau Agent about a different data source.

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
          const isDatasourceAllowedResult = await resourceAccessChecker.isDatasourceAllowed({
            datasourceLuid,
            extra,
          });
          if (!isDatasourceAllowedResult.allowed) {
            return new DatasourceNotAllowedError(isDatasourceAllowedResult.message).toErr();
          }

          return await useRestApi({
            ...extra,
            jwtScopes: cabuStartConversationTool.requiredApiScopes,
            callback: async (restApi) => {
              const response = await restApi.cabuMethods.startConversation({
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
