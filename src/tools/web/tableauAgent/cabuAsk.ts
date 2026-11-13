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
import { asTableauAgentNotEnabledError } from './cabuErrors.js';
import { decodeUtteranceArgs } from './cabuUtteranceArgs.js';

const paramsSchema = {
  conversationId: z.string().trim().nonempty(),
  utteranceArgs: z.string().trim().nonempty(),
  question: z.string().trim().nonempty(),
  parentLuid: luidSchema.optional(),
};

export const getCabuAskTool = (server: WebMcpServer): WebTool<typeof paramsSchema> => {
  const config = getConfig();
  const cabuAskTool = new WebTool({
    server,
    name: 'cabu-ask',
    disabled: new Provider(async () => !(await isTableauAgentToolsEnabled(config))),
    minRequiredRole: SiteRole.VIEWER,
    description: `
Asks Tableau Agent a question in a conversation already started by \`cabu-start-conversation\`. This tool is part of Tableau Agent: it uses CABU, Tableau Agent's natural-language Q&A service.

**Tableau Agent answers with its own LLM.** The question is sent to Tableau Agent. The LLM that backs Tableau Agent, not you, interprets the question, decides how to query the data, and writes the answer text this tool returns. When you pass the answer on to the user, say that it came from Tableau Agent.

**When to use:** for every question about the data source in a Tableau Agent conversation that the user explicitly opted in to and \`cabu-start-conversation\` started. After that opt-in, keep sending the user's follow-up questions about that data source here, even when they don't mention Tableau Agent again (for example "now just the West region" or "break that down by category"). Do not switch those follow-ups to \`query-datasource\`, and do not start a new conversation for them.

**When NOT to use:**
- Before the user has opted in. Never call this tool, or \`cabu-start-conversation\`, unless the user has explicitly asked for Tableau Agent; ordinary data questions go to \`get-datasource-metadata\` and \`query-datasource\`.
- After the user asks to stop using Tableau Agent, or for questions about a data source that has no open Tableau Agent conversation.

**Parameters:**

- \`conversationId\` (required): The \`conversationId\` returned by \`cabu-start-conversation\`.
- \`utteranceArgs\` (required): The opaque token returned by \`cabu-start-conversation\`. Pass the same value, unmodified, on every turn of this conversation; \`cabu-ask\` does not return a new one. Do not inspect or edit it.
- \`question\` (required): The natural-language question to ask CABU.
- \`parentLuid\` (optional): The \`nextParentLuid\` returned by the previous \`cabu-ask\` call in this conversation. Omit it for the first question in a conversation; include it on every follow-up question so CABU has the prior turn's context.

Returns the answer text, any datatables (rendered as truncated markdown), a data-details summary, and a \`nextParentLuid\` to thread into the next \`cabu-ask\` call for this conversation.

**Example Usage (a two-turn conversation):**
1. \`{ conversationId: "...", utteranceArgs: "...", question: "What were total sales?" }\`
2. \`{ conversationId: "<same as turn 1>", utteranceArgs: "<same as turn 1>", question: "Now just the West region.", parentLuid: "<nextParentLuid from turn 1>" }\`
`,
    paramsSchema,
    annotations: {
      title: 'Ask CABU',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    callback: async (
      { conversationId, utteranceArgs, question, parentLuid },
      extra,
    ): Promise<CallToolResult> => {
      return await cabuAskTool.logAndExecute<CabuAnswer>({
        extra,
        args: { conversationId, utteranceArgs, question, parentLuid },
        callback: async () => {
          let decoded: ReturnType<typeof decodeUtteranceArgs>;
          try {
            decoded = decodeUtteranceArgs(utteranceArgs);
          } catch (error) {
            return new ArgsValidationError(getExceptionMessage(error)).toErr();
          }

          // utteranceArgs is an opaque, unsigned token round-tripped by the caller, so it cannot be
          // trusted as proof that cabu-start-conversation already checked these datasources --
          // re-check them here against the same tool-scoping rules.
          for (const { datasourceLuid } of decoded.datasources) {
            if (!datasourceLuid) {
              return new DatasourceNotAllowedError(
                'utteranceArgs is missing a datasourceLuid for one of its datasources. Start a new conversation with cabu-start-conversation and use the utteranceArgs it returns.',
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
                'CABU did not return an utteranceId for this question.',
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
