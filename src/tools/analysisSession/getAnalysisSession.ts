import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Err, Ok } from 'ts-results-es';
import { z } from 'zod';

import { AnalysisSession } from '../../resources/analysisSession.js';
import { analysisSessionStore } from '../../resources/analysisSessionStore.js';
import { Server } from '../../server.js';
import { Tool } from '../tool.js';

const paramsSchema = {
    sessionId: z.string().uuid().describe('The analysis session ID'),
};

type GetSessionError = { type: 'not-found'; sessionId: string };

export const getGetAnalysisSessionTool = (server: Server): Tool<typeof paramsSchema> => {
    const tool = new Tool({
        server,
        name: 'get-analysis-session',
        description: `
Retrieves the current state of an analysis session.

Returns the full session including:
- Current hypothesis and its history
- All facts established with their evidence
- Active assumptions
- Scope boundaries
- Query history

Use this to review progress or resume an analysis.
    `.trim(),
        paramsSchema,
        annotations: {
            title: 'Get Analysis Session',
            readOnlyHint: true,
            openWorldHint: false,
        },
        callback: async ({ sessionId }, { requestId, authInfo }): Promise<CallToolResult> => {
            return await tool.logAndExecute<AnalysisSession, GetSessionError>({
                requestId,
                authInfo,
                args: { sessionId },
                callback: async () => {
                    const session = analysisSessionStore.getIfValid(sessionId);
                    if (!session) {
                        return new Err({ type: 'not-found', sessionId });
                    }
                    analysisSessionStore.touch(sessionId);
                    return new Ok(session);
                },
                constrainSuccessResult: (result) => ({ type: 'success', result }),
                getErrorText: (error) => `Analysis session not found or expired: ${error.sessionId}`,
            });
        },
    });

    return tool;
};
