import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Err } from 'ts-results-es';
import z from 'zod';

import { getConfig } from '../../../config.js';
import { useRestApi } from '../../../restApiInstance.js';
import { PulseDisabledError } from '../../../sdks/tableau/methods/pulseMethods.js';
import {
  pulseInsightBriefRequestSchema,
  PulseInsightBriefResponse,
} from '../../../sdks/tableau/types/pulse.js';
import { Server } from '../../../server.js';
import { getTableauAuthInfo } from '../../../server/oauth/getTableauAuthInfo.js';
import { Tool } from '../../tool.js';
import { getPulseDisabledError } from '../getPulseDisabledError.js';

const paramsSchema = {
  briefRequest: pulseInsightBriefRequestSchema,
};

export type GeneratePulseInsightBriefError =
  | {
      type: 'feature-disabled';
      reason: PulseDisabledError;
    }
  | {
      type: 'datasource-not-allowed';
      message: string;
    };

export const getGeneratePulseInsightBriefTool = (server: Server): Tool<typeof paramsSchema> => {
  const generatePulseInsightBriefTool = new Tool({
    server,
    name: 'generate-pulse-insight-brief',
    description: `
Generate a concise insight brief for Pulse Metrics using Tableau REST API. This endpoint provides AI-powered conversational insights based on natural language questions about your metrics.

**What is an Insight Brief?**
An insight brief is an AI-generated response to questions about Pulse metrics. It provides:
- Natural language answers to specific questions
- Contextual summaries based on metric data
- Action-oriented advice and recommendations
- Conversational format optimized for chat interfaces

**Insight Brief vs. Other Bundle Types:**
- **Brief**: AI-powered conversational insights based on natural language questions (this endpoint)
- **Detail**: Comprehensive analysis with full visualizations and trend breakdowns
- **Ban**: Current value with period-over-period change and top dimensional insights
- **Breakdown**: Emphasizes categorical dimension analysis and distributions

**Parameters:**
- \`briefRequest\` (required): The request to generate a brief for. This includes:
  - \`language\`: Language for the response (e.g., 'LANGUAGE_EN_US')
  - \`locale\`: Locale for formatting (e.g., 'LOCALE_EN_US')
  - \`messages\`: Array of conversation messages containing:
    - \`action_type\`: Type of action ('ACTION_TYPE_ANSWER', 'ACTION_TYPE_SUMMARIZE', 'ACTION_TYPE_ADVISE')
    - \`content\`: The user's question or prompt (natural language)
    - \`role\`: Who initiated the request ('ROLE_USER' or 'ROLE_ASSISTANT')
    - \`metric_group_context\`: Array of metrics to analyze (metadata + metric specification)
    - \`metric_group_context_resolved\`: Whether the metric context has been resolved (boolean)
  - \`now\`: Optional current time in 'YYYY-MM-DD HH:MM:SS' or 'YYYY-MM-DD' format (defaults to midnight if time omitted)
  - \`time_zone\`: Optional timezone for date/time calculations

**Action Types:**
- \`ACTION_TYPE_ANSWER\`: Answer a specific question about the metric
- \`ACTION_TYPE_SUMMARIZE\`: Provide a summary of metric insights
- \`ACTION_TYPE_ADVISE\`: Give recommendations or advice based on metric data

**Example Usage:**
- Ask a question about a metric:
    briefRequest: {
      language: 'LANGUAGE_EN_US',
      locale: 'LOCALE_EN_US',
      messages: [
        {
          action_type: 'ACTION_TYPE_ANSWER',
          content: 'Why did sales increase this month?',
          role: 'ROLE_USER',
          metric_group_context: [
            {
              metadata: {
                name: 'Sales',
                id: 'CF32DDCC-362B-4869-9487-37DA4D152552',
                definition_id: 'BBC908D8-29ED-48AB-A78E-ACF8A424C8C3',
              },
              metric: {
                definition: { /* metric definition */ },
                specification: { /* metric specification */ },
              },
            }
          ],
          metric_group_context_resolved: true,
        }
      ],
      now: '2025-11-14 15:30:00',
      time_zone: 'America/Los_Angeles',
    }

- Get a summary of multiple metrics:
    briefRequest: {
      language: 'LANGUAGE_EN_US',
      locale: 'LOCALE_EN_US',
      messages: [
        {
          action_type: 'ACTION_TYPE_SUMMARIZE',
          content: 'Summarize the key changes across my metrics',
          role: 'ROLE_USER',
          metric_group_context: [
            { metadata: { /* Sales metric */ }, metric: { /* ... */ } },
            { metadata: { /* Revenue metric */ }, metric: { /* ... */ } },
            { metadata: { /* Customers metric */ }, metric: { /* ... */ } },
          ],
          metric_group_context_resolved: true,
        }
      ],
    }

- Get advice based on metric performance:
    briefRequest: {
      language: 'LANGUAGE_EN_US',
      locale: 'LOCALE_EN_US',
      messages: [
        {
          action_type: 'ACTION_TYPE_ADVISE',
          content: 'What should I focus on to improve revenue?',
          role: 'ROLE_USER',
          metric_group_context: [
            { metadata: { /* Revenue metric */ }, metric: { /* ... */ } },
          ],
          metric_group_context_resolved: true,
        }
      ],
    }

**Use Cases:**
- **Conversational analytics** - Natural language Q&A about metrics
- **ChatGPT/Claude integration** - AI-powered metric insights
- **Slack/Teams bots** - Interactive metric exploration
- **Executive briefings** - "What should I know about my metrics today?"
- **Intelligent alerts** - Context-aware notifications with explanations
- **Multi-metric analysis** - Ask questions across multiple metrics at once
`,
    paramsSchema,
    annotations: {
      title: 'Generate Pulse Insight Brief',
      readOnlyHint: true,
      openWorldHint: false,
    },
    callback: async ({ briefRequest }, { requestId, authInfo }): Promise<CallToolResult> => {
      const config = getConfig();
      return await generatePulseInsightBriefTool.logAndExecute<
        PulseInsightBriefResponse,
        GeneratePulseInsightBriefError
      >({
        requestId,
        authInfo,
        args: { briefRequest },
        callback: async () => {
        //   const { datasourceIds } = config.boundedContext;
        //   if (datasourceIds) {
        //     // Validate all datasources in the metric group context
        //     const metricsContext = briefRequest.messages.metric_group_context;
        //     for (const metricContext of metricsContext) {
        //       const datasourceLuid = metricContext.metric.datasource_luid;

        //       if (!datasourceIds.has(datasourceLuid)) {
        //         return new Err({
        //           type: 'datasource-not-allowed',
        //           message: [
        //             'The set of allowed metric insights that can be queried is limited by the server configuration.',
        //             'Generating the Pulse Insight Brief is not allowed because one or more metrics are derived',
        //             `from the data source with LUID ${datasourceLuid}, which is not in the allowed set of data sources.`,
        //           ].join(' '),
        //         });
        //       }
        //     }
        //   }

          const result = await useRestApi({
            config,
            requestId,
            server,
            jwtScopes: ['tableau:insights:read'],
            authInfo: getTableauAuthInfo(authInfo),
            callback: async (restApi) =>
              await restApi.pulseMethods.generatePulseInsightBrief(briefRequest),
          });

          if (result.isErr()) {
            return new Err({
              type: 'feature-disabled',
              reason: result.error,
            });
          }

          return result;
        },
        constrainSuccessResult: (insightBrief) => {
          return {
            type: 'success',
            result: insightBrief,
          };
        },
        getErrorText: (error) => {
          switch (error.type) {
            case 'feature-disabled':
              return getPulseDisabledError(error.reason);
            case 'datasource-not-allowed':
              return error.message;
          }
        },
      });
    },
  });

  return generatePulseInsightBriefTool;
};

