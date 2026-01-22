import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Err, Ok } from 'ts-results-es';
import { z } from 'zod';

import { analysisSessionStore } from '../../resources/analysisSessionStore.js';
import { Server } from '../../server.js';
import { Tool } from '../tool.js';

const paramsSchema = {
    sessionId: z.string().uuid().describe('The analysis session ID to delete'),
};

type DeleteSessionError = { type: 'not-found'; sessionId: string };
type DeleteSessionResult = { message: string; sessionId: string };

export const getDeleteAnalysisSessionTool = (server: Server): Tool<typeof paramsSchema> => {
    const tool = new Tool({
        server,
        name: 'delete-analysis-session',
        description: `
Deletes an analysis session and all its associated data.

Use this to:
- Clean up after completing an analysis
- Discard an abandoned investigation
- Free up resources

This action is irreversible.
    `.trim(),
        paramsSchema,
        annotations: {
            title: 'Delete Analysis Session',
            readOnlyHint: false,
            openWorldHint: false,
        },
        callback: async ({ sessionId }, { requestId, authInfo }): Promise<CallToolResult> => {
            return await tool.logAndExecute<DeleteSessionResult, DeleteSessionError>({
                requestId,
                authInfo,
                args: { sessionId },
                callback: async () => {
                    const deleted = analysisSessionStore.delete(sessionId);
                    if (!deleted) {
                        return new Err({ type: 'not-found', sessionId });
                    }
                    return new Ok({ message: 'Analysis session deleted', sessionId });
                },
                constrainSuccessResult: (result) => ({ type: 'success', result }),
                getErrorText: (error) => `Analysis session not found: ${error.sessionId}`,
            });
        },
    });

    return tool;
};
