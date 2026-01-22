import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Err, Ok } from 'ts-results-es';
import { z } from 'zod';

import { analysisSessionStore } from '../../resources/analysisSessionStore.js';
import { Server } from '../../server.js';
import { Tool } from '../tool.js';

const paramsSchema = {
    sessionId: z.string().uuid(),
};

type SummarizeError = { type: 'not-found'; sessionId: string };
type SessionSummary = {
    sessionName: string;
    duration: { started: string; lastActivity: string };
    hypothesis: { current?: string; status: string; evolutionCount: number };
    facts: {
        total: number;
        byConfidence: Record<string, number>;
        bySource: Record<string, number>;
        claims: string[];
    };
    assumptions: {
        total: number;
        active: number;
        byCategory: Record<string, number>;
        statements: string[];
    };
    scope: {
        datasourcesAnalyzed: number;
        workbooksInScope: number;
        viewsImported: number;
        timeRange?: { field?: string; start?: string; end?: string };
        filtersApplied: number;
    };
    queries: { total: number; datasourcesCovered: number };
};

export const getSummarizeSessionTool = (server: Server): Tool<typeof paramsSchema> => {
    const tool = new Tool({
        server,
        name: 'summarize-analysis-session',
        description: `
Generates a structured summary of an analysis session.

The summary includes:
- Hypothesis evolution (initial -> current with status)
- Key facts established with confidence levels
- Active assumptions that should be noted
- Scope of the analysis
- Query count and coverage

Use this to conclude an analysis or brief stakeholders.
    `.trim(),
        paramsSchema,
        annotations: {
            title: 'Summarize Analysis Session',
            readOnlyHint: true,
            openWorldHint: false,
        },
        callback: async ({ sessionId }, { requestId, authInfo }): Promise<CallToolResult> => {
            return await tool.logAndExecute<SessionSummary, SummarizeError>({
                requestId,
                authInfo,
                args: { sessionId },
                callback: async () => {
                    const session = analysisSessionStore.getIfValid(sessionId);
                    if (!session) {
                        return new Err({ type: 'not-found', sessionId });
                    }

                    const summary: SessionSummary = {
                        sessionName: session.name || 'Unnamed Analysis',
                        duration: {
                            started: session.createdAt,
                            lastActivity: session.lastActivityAt,
                        },
                        hypothesis: {
                            current: session.hypothesis.statement,
                            status: session.hypothesis.status,
                            evolutionCount: session.hypothesis.history.length,
                        },
                        facts: {
                            total: session.factStore.length,
                            byConfidence: {
                                curated: session.factStore.filter((f) => f.confidence === 'curated').length,
                                verified: session.factStore.filter((f) => f.confidence === 'verified').length,
                                inferred: session.factStore.filter((f) => f.confidence === 'inferred').length,
                                assumed: session.factStore.filter((f) => f.confidence === 'assumed').length,
                            },
                            bySource: {
                                fromQueries: session.factStore.filter((f) => f.evidence.type === 'query').length,
                                fromWorkbooks: session.factStore.filter((f) => f.evidence.type === 'view').length,
                            },
                            claims: session.factStore.map((f) => f.claim),
                        },
                        assumptions: {
                            total: session.assumptions.length,
                            active: session.assumptions.filter((a) => a.status === 'active').length,
                            byCategory: {
                                data_quality: session.assumptions.filter((a) => a.category === 'data_quality')
                                    .length,
                                business_logic: session.assumptions.filter((a) => a.category === 'business_logic')
                                    .length,
                                temporal: session.assumptions.filter((a) => a.category === 'temporal').length,
                                scope: session.assumptions.filter((a) => a.category === 'scope').length,
                            },
                            statements: session.assumptions
                                .filter((a) => a.status === 'active')
                                .map((a) => a.statement),
                        },
                        scope: {
                            datasourcesAnalyzed: session.scope.datasources.length,
                            workbooksInScope: session.scope.workbooks.length,
                            viewsImported: session.scope.workbooks.reduce((sum, w) => sum + w.viewIds.length, 0),
                            timeRange: session.scope.timeRange,
                            filtersApplied: session.scope.filters.length,
                        },
                        queries: {
                            total: session.queryHistory.length,
                            datasourcesCovered: [...new Set(session.queryHistory.map((q) => q.datasourceLuid))]
                                .length,
                        },
                    };

                    analysisSessionStore.touch(sessionId);

                    return new Ok(summary);
                },
                constrainSuccessResult: (result) => ({ type: 'success', result }),
                getErrorText: (error) => `Analysis session not found: ${error.sessionId}`,
            });
        },
    });

    return tool;
};
