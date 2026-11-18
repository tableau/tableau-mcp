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
import { encodeConversationToken } from './cabuConversationToken.js';
import { asTableauAgentNotEnabledError } from './cabuErrors.js';

// CES samples field values in the background using this request's session, which `useRestApi`
// signs out when the callback returns. Sampling a data source takes about 2 s.
const SAMPLING_WAIT_MS = 15_000;

const paramsSchema = {
  datasourceLuid: luidSchema,
  workbookLuid: luidSchema.optional(),
};

// CES's utterance endpoint requires a `localization` on every turn, but `tableau-agent-start-conversation`
// has no caller-supplied locale to pass through -- see spec Non-goals ("locale negotiation is out
// of scope for the PDS-only demo"). English is a safe, fixed default for the demo.
const DEFAULT_LOCALIZATION: Localization = { locale: 'en-US', language: 'en' };

export const getCabuStartConversationTool = (
  server: WebMcpServer,
): WebTool<typeof paramsSchema> => {
  const config = getConfig();
  const cabuStartConversationTool = new WebTool({
    server,
    name: 'tableau-agent-start-conversation',
    disabled: new Provider(async () => !(await isTableauAgentToolsEnabled(config))),
    minRequiredRole: SiteRole.VIEWER,
    description: `
**Call this tool only when the user names Tableau Agent.** The user's message must contain "Ask Tableau Agent", "use Tableau Agent", or "use Tableau's agent" (in any capitalization). "Tableau's agent" means Tableau Agent, so "Use Tableau's agent to find total sales by region" counts: call this tool. A request for an agent that doesn't say "Tableau" does not count, even when the message mentions Tableau data: "Hand this off to an agent: which region had the highest profit?" does not name Tableau Agent. Nor do "a sub-agent", "another agent", "delegate", or "use CABU". Neither does a hard data question, or the fact that this tool is available. In all of those cases, do not call this tool: answer with \`get-datasource-metadata\` and \`query-datasource\` as usual.

Tableau Agent is an agent that answers analytical questions about a published data source, server-side. This tool starts a Tableau Agent conversation about one data source; \`tableau-agent-ask\` asks it questions.

**How it works.** Starting a conversation is like spawning a sub-agent with fresh context: Tableau Agent sees only the questions you send it through \`tableau-agent-ask\`, not your conversation with the user. Its own LLM interprets each question, queries the data, and writes the answer. Tell the user the answer came from Tableau Agent. Each \`tableau-agent-ask\` call blocks until Tableau Agent finishes, which takes noticeably longer than \`query-datasource\`, often 30 seconds or more. Tableau Agent's LLM runs on the Salesforce LLM gateway, not your token budget.

**The server keeps no state.** This tool returns one opaque \`conversationToken\`. That token, plus the \`nextParentLuid\` each \`tableau-agent-ask\` call returns, is the only link between turns: the MCP server stores nothing between calls. Pass the token, unmodified, to every \`tableau-agent-ask\` call in this conversation.

**Follow-ups.** Once a conversation is open, send every follow-up question about that data source to \`tableau-agent-ask\`, even when the user doesn't name Tableau Agent again. Call this tool again only if the user asks to start over, or asks Tableau Agent about a different data source.

Use \`search-content\` or \`list-datasources\` first to find the data source's LUID.

**Parameters:**

- \`datasourceLuid\` (required): The LUID of the published data source to ask Tableau Agent about.
- \`workbookLuid\` (optional): The LUID of a published workbook that connects to this data source. With it, Tableau Agent sees sample values of the data source's fields, which helps it match names and other values in a question, and applies the workbook's business preferences. Pass it when the user names a workbook or dashboard built on this data source, or when you already know one. \`get-workbook\` lists a workbook's data sources: the one to use has this data source as its \`publishedParent\`. Without a workbook, Tableau Agent sees only the data source's fields.
`,
    paramsSchema,
    annotations: {
      title: 'Start Tableau Agent Conversation',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    callback: async ({ datasourceLuid, workbookLuid }, extra): Promise<CallToolResult> => {
      return await cabuStartConversationTool.logAndExecute<{ conversationToken: string }>({
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
                  'Tableau Agent did not return a conversationId for this conversation.',
                ).toErr();
              }

              if (
                workbookLuid &&
                response.datasources?.some((datasource) => datasource.vdsDatasourceLuid)
              ) {
                await waitForSampling(restApi.cabuMethods, response.conversationId);
              }

              const conversationToken = encodeConversationToken({
                conversationId: response.conversationId,
                scope: response.scope,
                datasources: response.datasources ?? [],
                localization: DEFAULT_LOCALIZATION,
                embedded: false,
              });

              return new Ok({ conversationToken });
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
        logger: 'tableau-agent-start-conversation',
        data: { conversationId, status: result.status },
      });
    }
  } catch (error) {
    log({
      message: `Tableau Agent field sampling wait failed: ${error instanceof Error ? error.message : String(error)}`,
      level: 'warning',
      logger: 'tableau-agent-start-conversation',
      data: { conversationId },
    });
  }
}
