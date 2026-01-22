import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { randomUUID } from 'crypto';
import { Err, Ok } from 'ts-results-es';
import { z } from 'zod';

import { Assumption } from '../../resources/analysisSession.js';
import { analysisSessionStore } from '../../resources/analysisSessionStore.js';
import { Server } from '../../server.js';
import { Tool } from '../tool.js';

const paramsSchema = {
    sessionId: z.string().uuid(),
    statement: z.string().describe('The assumption being made'),
    category: z.enum(['data_quality', 'business_logic', 'temporal', 'scope']),
    validationQuery: z
        .record(z.any())
        .optional()
        .describe('Optional query to validate this assumption'),
};

type AddAssumptionError = { type: 'not-found'; sessionId: string };
type AddAssumptionResult = { message: string; assumptionId: string; totalAssumptions: number };

export const getAddAssumptionTool = (server: Server): Tool<typeof paramsSchema> => {
    const tool = new Tool({
        server,
        name: 'add-assumption',
        description: `
Records an assumption being made in the analysis.

Categories:
- data_quality: Assumptions about data completeness, accuracy, freshness
- business_logic: Assumptions about how metrics are calculated or rules applied
- temporal: Assumptions about time periods, seasonality, trends
- scope: Assumptions about what's included/excluded from analysis

Recording assumptions explicitly helps:
- Identify potential sources of error
- Enable later validation
- Document analytical reasoning
    `.trim(),
        paramsSchema,
        annotations: {
            title: 'Add Assumption',
            readOnlyHint: false,
            openWorldHint: false,
        },
        callback: async (
            { sessionId, statement, category, validationQuery },
            { requestId, authInfo },
        ): Promise<CallToolResult> => {
            return await tool.logAndExecute<AddAssumptionResult, AddAssumptionError>({
                requestId,
                authInfo,
                args: { sessionId, statement, category, validationQuery },
                callback: async () => {
                    const session = analysisSessionStore.getIfValid(sessionId);
                    if (!session) {
                        return new Err({ type: 'not-found', sessionId });
                    }

                    const assumption: Assumption = {
                        id: randomUUID(),
                        statement,
                        category,
                        status: 'active',
                        validationQuery,
                    };

                    session.assumptions.push(assumption);
                    analysisSessionStore.touch(sessionId);

                    return new Ok({
                        message: 'Assumption recorded',
                        assumptionId: assumption.id,
                        totalAssumptions: session.assumptions.length,
                    });
                },
                constrainSuccessResult: (result) => ({ type: 'success', result }),
                getErrorText: (error) => `Analysis session not found: ${error.sessionId}`,
            });
        },
    });

    return tool;
};
