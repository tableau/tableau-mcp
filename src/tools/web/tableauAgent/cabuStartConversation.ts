import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';

import { getConfig } from '../../../config.js';
import {
  ArgsValidationError,
  DatasourceNotAllowedError,
  UnknownError,
  WorkbookNotAllowedError,
} from '../../../errors/mcpToolError.js';
import { isTableauAgentToolsEnabled } from '../../../features/tableauAgentTools.js';
import { log } from '../../../logging/logger.js';
import { useRestApi } from '../../../restApiInstance.js';
import { luidSchema } from '../../../sdks/routeSafety/ids.js';
import type CabuMethods from '../../../sdks/tableau/methods/cabuMethods.js';
import { Localization } from '../../../sdks/tableau/types/cabu.js';
import { SiteRole } from '../../../sdks/tableau/types/user.js';
import { WebMcpServer } from '../../../server.web.js';
import { Provider } from '../../../utils/provider.js';
import { resourceAccessChecker } from '../resourceAccessChecker.js';
import { WebTool } from '../tool.js';
import { asTableauAgentNotEnabledError } from './cabuErrors.js';
import { encodeUtteranceArgs } from './cabuUtteranceArgs.js';

// CES samples field values in the background using this request's session, which `useRestApi`
// signs out when the callback returns. Sampling a data source takes about 2 s.
const SAMPLING_WAIT_MS = 15_000;

const paramsSchema = {
  datasourceLuid: luidSchema,
  workbookLuid: luidSchema.optional(),
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
- \`workbookLuid\` (optional): The LUID of a published workbook that connects to this data source. With it, Tableau Agent sees sample values of the data source's fields, which helps it match names and other values in a question, and applies the workbook's business preferences. Pass it when the user names a workbook or dashboard built on this data source, or when you already know one. \`get-workbook\` lists a workbook's data sources: the one to use has this data source as its \`publishedParent\`. Without a workbook, Tableau Agent sees only the data source's fields.
`,
    paramsSchema,
    annotations: {
      title: 'Start CABU Conversation',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    callback: async ({ datasourceLuid, workbookLuid }, extra): Promise<CallToolResult> => {
      return await cabuStartConversationTool.logAndExecute<{
        conversationId: string;
        utteranceArgs: string;
      }>({
        extra,
        args: { datasourceLuid, workbookLuid },
        callback: async () => {
          const isDatasourceAllowedResult = await resourceAccessChecker.isDatasourceAllowed({
            datasourceLuid,
            extra,
          });
          if (!isDatasourceAllowedResult.allowed) {
            return new DatasourceNotAllowedError(isDatasourceAllowedResult.message).toErr();
          }
          if (workbookLuid) {
            const isWorkbookAllowedResult = await resourceAccessChecker.isWorkbookAllowed({
              workbookId: workbookLuid,
              extra,
            });
            if (!isWorkbookAllowedResult.allowed) {
              return new WorkbookNotAllowedError(isWorkbookAllowedResult.message).toErr();
            }
          }

          return await useRestApi({
            ...extra,
            jwtScopes: cabuStartConversationTool.requiredApiScopes,
            callback: async (restApi) => {
              let name: string | undefined;
              if (workbookLuid) {
                // CES finds the workbook's connection to this datasource by name, so pass the name
                // it will look for -- and fail here, not silently in CES, when there is none.
                const [datasource, connections] = await Promise.all([
                  restApi.datasourcesMethods.queryDatasource({
                    siteId: restApi.siteId,
                    datasourceId: datasourceLuid,
                  }),
                  restApi.workbooksMethods.queryWorkbookConnections({
                    siteId: restApi.siteId,
                    workbookId: workbookLuid,
                  }),
                ]);
                name = datasource.name;
                if (!connections.some((connection) => connection.datasource?.name === name)) {
                  return new ArgsValidationError(
                    `Workbook ${workbookLuid} does not connect to the data source "${name}" (${datasourceLuid}). Pass a workbook built on this data source, or omit workbookLuid.`,
                  ).toErr();
                }
              }

              let response;
              try {
                response = await restApi.cabuMethods.startConversation({
                  ...(workbookLuid && { workbookLuid }),
                  dashboardDatasources: [{ datasourceLuid, ...(name && { name }) }],
                  embedded: false,
                });
              } catch (error) {
                const notEnabled = asTableauAgentNotEnabledError(error);
                if (notEnabled) {
                  return notEnabled.toErr();
                }
                throw error;
              }

              if (!response.conversationId) {
                return new UnknownError(
                  'CABU did not return a conversationId for this conversation.',
                ).toErr();
              }

              if (
                workbookLuid &&
                response.datasources?.some((datasource) => datasource.vdsDatasourceLuid)
              ) {
                await waitForSampling(restApi.cabuMethods, response.conversationId);
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

/** Best effort: without samples, answers are just less precise, so never fail the start. */
async function waitForSampling(
  cabuMethods: Pick<CabuMethods, 'waitForSampling'>,
  conversationId: string,
): Promise<void> {
  try {
    const result = await cabuMethods.waitForSampling(conversationId, SAMPLING_WAIT_MS);
    if (result.status !== 'complete') {
      log({
        message: `Tableau Agent field sampling did not finish: ${result.status}`,
        level: 'warning',
        logger: 'cabu-start-conversation',
        data: { conversationId, status: result.status },
      });
    }
  } catch (error) {
    log({
      message: `Tableau Agent field sampling wait failed: ${error instanceof Error ? error.message : String(error)}`,
      level: 'warning',
      logger: 'cabu-start-conversation',
      data: { conversationId },
    });
  }
}
