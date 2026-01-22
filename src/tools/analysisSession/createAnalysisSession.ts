import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { AnalysisSession } from '../../resources/analysisSession.js';
import { analysisSessionStore } from '../../resources/analysisSessionStore.js';
import { Server } from '../../server.js';
import { Tool } from '../tool.js';

const paramsSchema = {
    name: z.string().optional().describe('Optional name for the analysis session'),
    initialHypothesis: z.string().optional().describe('Initial hypothesis to test'),
    datasources: z
        .array(z.string())
        .optional()
        .describe('Datasource LUIDs to include in scope'),
    workbooks: z
        .array(z.string())
        .optional()
        .describe(
            'Workbook IDs to include in scope. Views from these workbooks can be imported as pre-established facts.',
        ),
};

type CreateSessionResult = {
    sessionId: string;
    message: string;
    hypothesis: AnalysisSession['hypothesis'];
    scope: AnalysisSession['scope'];
    hint?: string;
};

export const getCreateAnalysisSessionTool = (server: Server): Tool<typeof paramsSchema> => {
    const tool = new Tool({
        server,
        name: 'create-analysis-session',
        description: `
Creates a new analysis session to track analytical state across multiple queries.

Use this tool when beginning a multi-step analytical investigation. The session will:
- Track your hypothesis and its evolution
- Accumulate facts with evidence from queries OR from pre-built workbook views
- Record assumptions that should be validated
- Maintain scope boundaries for the analysis
- Preserve query history for audit and replay

You can optionally include workbook IDs in the scope. Workbooks contain pre-built views
that represent analyst-curated analytical artifacts. These can be imported as facts
using the import-workbook-facts tool, giving the session a head start with established
analytical conclusions.

Returns a session ID that should be passed to subsequent tools.
    `.trim(),
        paramsSchema,
        annotations: {
            title: 'Create Analysis Session',
            readOnlyHint: false,
            openWorldHint: false,
        },
        callback: async (
            { name, initialHypothesis, datasources, workbooks },
            { requestId, authInfo },
        ): Promise<CallToolResult> => {
            return await tool.logAndExecute<CreateSessionResult>({
                requestId,
                authInfo,
                args: { name, initialHypothesis, datasources, workbooks },
                callback: async () => {
                    const session = analysisSessionStore.create(name);

                    if (initialHypothesis) {
                        session.hypothesis = {
                            statement: initialHypothesis,
                            status: 'forming',
                            history: [
                                {
                                    statement: initialHypothesis,
                                    timestamp: new Date().toISOString(),
                                    reason: 'Initial hypothesis',
                                },
                            ],
                        };
                    }

                    if (datasources && datasources.length > 0) {
                        session.scope.datasources = datasources;
                    }

                    if (workbooks && workbooks.length > 0) {
                        session.scope.workbooks = workbooks.map((id) => ({
                            workbookId: id,
                            workbookName: '', // Will be populated on first access
                            viewIds: [],
                        }));
                    }

                    return new Ok({
                        sessionId: session.sessionId,
                        message: 'Analysis session created',
                        hypothesis: session.hypothesis,
                        scope: session.scope,
                        hint: workbooks?.length
                            ? 'Use import-workbook-facts to import pre-built analytical facts from the scoped workbooks.'
                            : undefined,
                    });
                },
                constrainSuccessResult: (result) => ({ type: 'success', result }),
            });
        },
    });

    return tool;
};
