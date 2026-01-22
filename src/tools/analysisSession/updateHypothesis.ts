import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Err, Ok } from 'ts-results-es';
import { z } from 'zod';

import { Hypothesis } from '../../resources/analysisSession.js';
import { analysisSessionStore } from '../../resources/analysisSessionStore.js';
import { Server } from '../../server.js';
import { Tool } from '../tool.js';

const paramsSchema = {
    sessionId: z.string().uuid(),
    hypothesis: z.string().describe('The new or revised hypothesis statement'),
    status: z.enum(['forming', 'testing', 'confirmed', 'refuted', 'revised']),
    reason: z.string().describe('Reason for this hypothesis update'),
};

type UpdateHypothesisError = { type: 'not-found'; sessionId: string };
type UpdateHypothesisResult = { message: string; hypothesis: Hypothesis };

export const getUpdateHypothesisTool = (server: Server): Tool<typeof paramsSchema> => {
    const tool = new Tool({
        server,
        name: 'update-hypothesis',
        description: `
Updates the hypothesis for an analysis session.

Use this tool when:
- Refining an initial hypothesis based on exploratory data
- Marking a hypothesis as confirmed or refuted based on evidence
- Revising a hypothesis after new facts emerge

The previous hypothesis is preserved in history for audit purposes.
    `.trim(),
        paramsSchema,
        annotations: {
            title: 'Update Hypothesis',
            readOnlyHint: false,
            openWorldHint: false,
        },
        callback: async (
            { sessionId, hypothesis, status, reason },
            { requestId, authInfo },
        ): Promise<CallToolResult> => {
            return await tool.logAndExecute<UpdateHypothesisResult, UpdateHypothesisError>({
                requestId,
                authInfo,
                args: { sessionId, hypothesis, status, reason },
                callback: async () => {
                    const session = analysisSessionStore.getIfValid(sessionId);
                    if (!session) {
                        return new Err({ type: 'not-found', sessionId });
                    }

                    // Add current hypothesis to history if exists (mark as superseded)
                    if (session.hypothesis.statement) {
                        session.hypothesis.history.push({
                            statement: session.hypothesis.statement,
                            timestamp: new Date().toISOString(),
                            reason: `Superseded: ${reason}`,
                        });
                    }

                    // Update to new hypothesis
                    session.hypothesis.statement = hypothesis;
                    session.hypothesis.status = status;

                    // Record the new hypothesis in history
                    session.hypothesis.history.push({
                        statement: hypothesis,
                        timestamp: new Date().toISOString(),
                        reason,
                    });

                    analysisSessionStore.touch(sessionId);

                    return new Ok({
                        message: 'Hypothesis updated',
                        hypothesis: session.hypothesis,
                    });
                },
                constrainSuccessResult: (result) => ({ type: 'success', result }),
                getErrorText: (error) => `Analysis session not found: ${error.sessionId}`,
            });
        },
    });

    return tool;
};
