import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import {
  ArgsValidationError,
  CabuConversationNotFoundError,
  CabuResponseError,
  CabuStreamIncompleteError,
  UnknownError,
} from '../../../errors/mcpToolError.js';
import { useRestApi } from '../../../restApiInstance.js';
import { luidSchema } from '../../../sdks/routeSafety/ids.js';
import { SiteRole } from '../../../sdks/tableau/types/user.js';
import { WebMcpServer } from '../../../server.web.js';
import { getExceptionMessage } from '../../../utils/getExceptionMessage.js';
import { WebTool } from '../tool.js';
import { buildCabuAnswer, CabuAnswer } from './cabuAnswer.js';
import { getCabuConversationStore } from './cabuConversationStore.js';
import { decodeUtteranceArgs } from './cabuUtteranceArgs.js';

const paramsSchema = {
  conversationId: z.string().trim().nonempty(),
  utteranceArgs: z.string().trim().nonempty(),
  question: z.string().trim().nonempty(),
  parentLuid: luidSchema.optional(),
};

export const getCabuAskTool = (server: WebMcpServer): WebTool<typeof paramsSchema> => {
  const cabuAskTool = new WebTool({
    server,
    name: 'cabu-ask',
    minRequiredRole: SiteRole.VIEWER,
    description: `
Asks CABU (Tableau Agent's natural-language Q&A over a published data source) a question within a conversation already started by \`cabu-start-conversation\`.

**Parameters:**

- \`conversationId\` (required): The \`conversationId\` returned by \`cabu-start-conversation\`.
- \`utteranceArgs\` (required): The opaque token returned by \`cabu-start-conversation\` (or by the most recent \`cabu-ask\` call in this conversation). Pass it through unmodified; do not inspect or edit it.
- \`question\` (required): The natural-language question to ask CABU.
- \`parentLuid\` (optional): The \`nextParentLuid\` returned by the previous \`cabu-ask\` call in this conversation. Omit it for the first question in a conversation; include it on every follow-up question so CABU has the prior turn's context.

Returns the answer text, any datatables (rendered as truncated markdown), a data-details summary, and a \`nextParentLuid\` to thread into the next \`cabu-ask\` call for this conversation.

**Example Usage (a two-turn conversation):**
1. \`{ conversationId: "...", utteranceArgs: "...", question: "What were total sales?" }\`
2. \`{ conversationId: "...", utteranceArgs: "...", question: "Now just the West region.", parentLuid: "<nextParentLuid from turn 1>" }\`
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
          let decoded;
          try {
            decoded = decodeUtteranceArgs(utteranceArgs);
          } catch (error) {
            return new ArgsValidationError(getExceptionMessage(error)).toErr();
          }

          const stored = getCabuConversationStore().get(conversationId);
          if (!stored) {
            return new CabuConversationNotFoundError(conversationId).toErr();
          }

          return await useRestApi({
            ...extra,
            jwtScopes: cabuAskTool.requiredApiScopes,
            callback: async (restApi) => {
              const { response: utteranceResponse, cookies: cookiesAfterAsk } =
                await restApi.cabuMethods.askUtterance(
                  conversationId,
                  {
                    utterance: { content: question, source: 'user' },
                    localization: decoded.localization,
                    scope: decoded.scope,
                    datasources: decoded.datasources,
                    parentLuid,
                    embedded: decoded.embedded,
                  },
                  stored.cookies,
                );

              if (!utteranceResponse.utteranceId) {
                return new UnknownError(
                  'CABU did not return an utteranceId for this question.',
                ).toErr();
              }

              // Persist the refreshed cookies before reading the stream, so a failed/aborted
              // stream read never loses the freshest cookie -- see cabuConversationStore.ts.
              getCabuConversationStore().set(conversationId, {
                cookies: cookiesAfterAsk,
                utteranceArgs,
              });

              const streamResult = await restApi.cabuMethods.streamUtterance(
                conversationId,
                utteranceResponse.utteranceId,
                cookiesAfterAsk,
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
            },
          });
        },
        constrainSuccessResult: (result) => ({ type: 'success', result }),
      });
    },
  });

  return cabuAskTool;
};
