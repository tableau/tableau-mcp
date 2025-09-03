import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import z from 'zod';

import { getConfig } from '../../../config.js';
import { useRestApi } from '../../../restApiInstance.js';
import { pulseMetricContextSchema } from '../../../sdks/tableau/types/pulse.js';
import { Server } from '../../../server.js';
import { Tool } from '../../tool.js';

const paramsSchema = {
    question: z.string().min(1, 'Question cannot be empty'),
    metricContext: z
        .array(pulseMetricContextSchema)
        .min(1, 'At least one metric context is required'),
};

export const getGenerateInsightBriefTool = (server: Server): Tool<typeof paramsSchema> => {
    const generateInsightBriefTool = new Tool({
        server,
        name: 'generate-insight-brief',
        description: `
Generate a conversational insight brief for Tableau Pulse metrics using natural language questions. This tool powers the Pulse discover experience by analyzing metric data and providing AI-generated insights, visualizations, and follow-up questions.

**Use Cases:**
- Ask natural language questions about metric performance (e.g., "What happened to sales this quarter?")
- Get AI-generated insights explaining metric changes and trends
- Receive contextual visualizations and charts
- Discover follow-up questions for deeper analysis

**Parameters:**
- \`question\` (required): The natural language question about the metrics. Examples:
  - "What happened to Analytics Cloud CX - # of Doc Bugs Closed?"
  - "Why did sales increase last month?"
  - "What are the main drivers of revenue growth?"
  - "Which regions are performing best?"

- \`metricContext\` (required): Array of metric context objects containing the metric metadata and configuration. This provides the AI with the necessary context about which metrics to analyze. You typically get this from other Pulse tools like listing metrics or metric definitions.

**Response:**
The response includes:
- \`markup\`: HTML-formatted insight summary with key findings
- \`source_insights\`: Detailed array of insights with:
  - Type (top-drivers, top-contributors, popc, etc.)
  - Markup with formatted explanations
  - Interactive Vega-Lite visualizations
  - Factual data supporting the insights
  - Confidence scores
- \`follow_up_questions\`: AI-suggested questions for further exploration
- \`generation_id\`: Unique identifier for this insight generation

**Example Usage:**
1. First, get metric context from other tools
2. Ask a natural language question about the metrics
3. Receive comprehensive insights with explanations and visualizations
4. Use follow-up questions to dive deeper into specific aspects

**Note:** This tool requires metric context to be provided. Use other Pulse tools to gather the necessary metric definitions and data before making insight requests.
`,
        paramsSchema,
        annotations: {
            title: 'Generate Pulse Insight Brief',
            readOnlyHint: true,
            openWorldHint: false,
        },
        callback: async ({ question, metricContext }, { requestId }): Promise<CallToolResult> => {
            const config = getConfig();
            return await generateInsightBriefTool.logAndExecute({
                requestId,
                args: { question, metricContext },
                callback: async () => {
                    // Construct the request in the format expected by the API
                    const briefRequest = {
                        messages: [
                            {
                                role: 'ROLE_USER',
                                content: question,
                                metric_group_context: metricContext,
                            },
                        ],
                    };

                    return new Ok(
                        await useRestApi({
                            config,
                            requestId,
                            server,
                            jwtScopes: ['tableau:insights:read'], // This may need to be adjusted based on auth requirements
                            callback: async (restApi) =>
                                await restApi.pulseMethods.generatePulseInsightBrief(briefRequest),
                        }),
                    );
                },
            });
        },
    });

    return generateInsightBriefTool;
};
