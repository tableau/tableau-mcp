import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok, Result } from 'ts-results-es';
import { z } from 'zod';

import { getConfig } from '../../../config.js';
import {
  ArgsValidationError,
  CabuResponseError,
  CabuStreamIncompleteError,
  DatasourceNotAllowedError,
  McpToolError,
  UnknownError,
} from '../../../errors/mcpToolError.js';
import { isTableauAgentToolsEnabled } from '../../../features/tableauAgentTools.js';
import { useRestApi } from '../../../restApiInstance.js';
import { luidSchema } from '../../../sdks/routeSafety/ids.js';
import { RestApi } from '../../../sdks/tableau/restApi.js';
import { SiteRole } from '../../../sdks/tableau/types/user.js';
import { WebMcpServer } from '../../../server.web.js';
import { getExceptionMessage } from '../../../utils/getExceptionMessage.js';
import { Provider } from '../../../utils/provider.js';
import { resourceAccessChecker } from '../resourceAccessChecker.js';
import { WebTool } from '../tool.js';
import { buildCabuAnswer, CabuAnswer } from './cabuAnswer.js';
import { decodeConversationToken } from './cabuConversationToken.js';
import { asTableauAgentNotEnabledError } from './cabuErrors.js';

const paramsSchema = {
  conversationToken: z.string().trim().nonempty(),
  question: z.string().trim().nonempty(),
  parentLuid: luidSchema.optional(),
};

export const getCabuAskTool = (server: WebMcpServer): WebTool<typeof paramsSchema> => {
  const config = getConfig();
  const cabuAskTool = new WebTool({
    server,
    name: 'tableau-agent-ask',
    disabled: new Provider(async () => !(await isTableauAgentToolsEnabled(config))),
    minRequiredRole: SiteRole.VIEWER,
    description: `
**Call this tool only after the user names Tableau Agent.** Use it only in a conversation that \`tableau-agent-start-conversation\` started because the user's message contained "Ask Tableau Agent", "use Tableau Agent", or "use Tableau's agent" ("Tableau's agent" means Tableau Agent). A request for an agent that doesn't say "Tableau", such as "hand this off to an agent", or to "use CABU" does not count. After that, send every follow-up question about that data source here, even when the user doesn't name Tableau Agent again (for example "now just the West region" or "break that down by category"). Do not switch those follow-ups to \`query-datasource\`, and do not start a new conversation for them. Stop using this tool if the user asks to stop using Tableau Agent. Without an open conversation, answer data questions with \`get-datasource-metadata\` and \`query-datasource\`.

Asks Tableau Agent a question in a conversation started by \`tableau-agent-start-conversation\`. Tableau Agent is an agent that answers analytical questions about a published data source, server-side.

**How it works.** Tableau Agent is like a sub-agent: it sees only the questions you send it in this conversation, not your conversation with the user. Its own LLM interprets the question, queries the data, and writes the answer this tool returns. Tell the user the answer came from Tableau Agent. This call blocks until Tableau Agent finishes, which takes noticeably longer than \`query-datasource\`, often 30 seconds or more. Tableau Agent's LLM runs on the Salesforce LLM gateway, not your token budget.

**The server keeps no state.** The MCP server stores nothing between calls. The \`conversationToken\` from \`tableau-agent-start-conversation\` and the \`nextParentLuid\` from the previous \`tableau-agent-ask\` call are the only link between turns, so pass both back exactly as returned.

**Parameters:**

- \`conversationToken\` (required): The opaque token returned by \`tableau-agent-start-conversation\`. Pass the same value, unmodified, on every turn of this conversation; \`tableau-agent-ask\` does not return a new one.
- \`question\` (required): The question to ask Tableau Agent, in natural language.
- \`parentLuid\` (optional): The \`nextParentLuid\` returned by the previous \`tableau-agent-ask\` call in this conversation. Omit it for the first question; include it on every follow-up so Tableau Agent has the prior turn's context.

Returns the answer text, any datatables (rendered as truncated markdown), a data-details summary, and a \`nextParentLuid\` to pass to the next \`tableau-agent-ask\` call in this conversation.

**Example Usage (a two-turn conversation):**
1. \`{ conversationToken: "...", question: "What were total sales?" }\`
2. \`{ conversationToken: "<same as turn 1>", question: "Now just the West region.", parentLuid: "<nextParentLuid from turn 1>" }\`
`,
    paramsSchema,
    annotations: {
      title: 'Ask Tableau Agent',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    callback: async (
      { conversationToken, question, parentLuid },
      extra,
    ): Promise<CallToolResult> => {
      return await cabuAskTool.logAndExecute<CabuAnswer>({
        extra,
        args: { conversationToken, question, parentLuid },
        callback: async () => {
          let decoded: ReturnType<typeof decodeConversationToken>;
          try {
            decoded = decodeConversationToken(conversationToken);
          } catch (error) {
            return new ArgsValidationError(getExceptionMessage(error)).toErr();
          }

          // The token is unsigned and round-tripped by the caller, so it doesn't prove that
          // tableau-agent-start-conversation checked these datasources. Re-check them here.
          for (const { datasourceLuid } of decoded.datasources) {
            if (!datasourceLuid) {
              return new DatasourceNotAllowedError(
                'conversationToken is missing a datasourceLuid for one of its datasources. Start a new conversation with tableau-agent-start-conversation and use the conversationToken it returns.',
              ).toErr();
            }
            const isDatasourceAllowedResult = await resourceAccessChecker.isDatasourceAllowed({
              datasourceLuid,
              extra,
            });
            if (!isDatasourceAllowedResult.allowed) {
              return new DatasourceNotAllowedError(isDatasourceAllowedResult.message).toErr();
            }
          }

          return await useRestApi({
            ...extra,
            jwtScopes: cabuAskTool.requiredApiScopes,
            callback: async (restApi) => {
              try {
                return await askAndStream(restApi);
              } catch (error) {
                const notEnabled = asTableauAgentNotEnabledError(error);
                if (notEnabled) {
                  return notEnabled.toErr();
                }
                throw error;
              }
            },
          });

          async function askAndStream(restApi: RestApi): Promise<Result<CabuAnswer, McpToolError>> {
            const { conversationId } = decoded;
            const utteranceResponse = await restApi.cabuMethods.askUtterance(conversationId, {
              utterance: { content: question, source: 'user' },
              localization: decoded.localization,
              scope: decoded.scope,
              datasources: decoded.datasources,
              parentLuid,
              embedded: decoded.embedded,
            });

            if (!utteranceResponse.utteranceId) {
              return new UnknownError(
                'Tableau Agent did not return an utteranceId for this question.',
              ).toErr();
            }

            const streamResult = await restApi.cabuMethods.streamUtterance(
              conversationId,
              utteranceResponse.utteranceId,
            );

            if (streamResult.status === 'error') {
              return new CabuResponseError(
                streamResult.error.error_code,
                streamResult.error.error_details,
              ).toErr();
            }

            if (streamResult.status === 'incomplete') {
              return new CabuStreamIncompleteError().toErr();
            }

            // CES can signal an error even inside a nominally-"complete" stream.
            if (streamResult.responseComplete?.error_code) {
              return new CabuResponseError(
                streamResult.responseComplete.error_code,
                streamResult.responseComplete.error_details,
              ).toErr();
            }

            return new Ok(
              streamResult.responseComplete ? buildCabuAnswer(streamResult.responseComplete) : {},
            );
          }
        },
        constrainSuccessResult: (result) => ({ type: 'success', result }),
      });
    },
  });

  return cabuAskTool;
};
