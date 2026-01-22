import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { createHash, randomUUID } from 'crypto';
import { Err, Ok } from 'ts-results-es';
import { z } from 'zod';

import { DataSummary, Fact } from '../../resources/analysisSession.js';
import { analysisSessionStore } from '../../resources/analysisSessionStore.js';
import { storeQueryResult } from '../../resources/csvStorage.js';
import { analyzeQueryResult } from '../../resources/csvAnalyzer.js';
import { Server } from '../../server.js';
import { Tool } from '../tool.js';

const paramsSchema = {
  sessionId: z.string().uuid(),
  claim: z.string().describe('The factual claim being established'),
  datasourceLuid: z.string().describe('The datasource that provided evidence'),
  query: z.record(z.any()).describe('The VDS query that produced this fact'),
  queryResult: z.any().describe('The result data that supports this claim'),
  confidence: z.enum(['verified', 'inferred', 'assumed']).default('verified'),
};

type AddFactError = { type: 'not-found'; sessionId: string };
type AddFactResult = { message: string; factId: string; totalFacts: number };

export const getAddFactTool = (server: Server): Tool<typeof paramsSchema> => {
  const tool = new Tool({
    server,
    name: 'add-fact',
    description: `
Adds a fact to the analysis session's fact store.

Facts represent claims that have been established through data queries.
Each fact includes:
- The claim statement
- Evidence linking to the query and datasource
- A hash of the result for cache validation
- Confidence level (verified, inferred, assumed)

Use this after running a query that establishes a meaningful finding.
    `.trim(),
    paramsSchema,
    annotations: {
      title: 'Add Fact',
      readOnlyHint: false,
      openWorldHint: false,
    },
    callback: async (
      { sessionId, claim, datasourceLuid, query, queryResult, confidence },
      { requestId, authInfo },
    ): Promise<CallToolResult> => {
      return await tool.logAndExecute<AddFactResult, AddFactError>({
        requestId,
        authInfo,
        args: { sessionId, claim, datasourceLuid, query, queryResult, confidence },
        callback: async () => {
          const session = analysisSessionStore.getIfValid(sessionId);
          if (!session) {
            return new Err({ type: 'not-found', sessionId });
          }

          const resultHash = createHash('sha256')
            .update(JSON.stringify(queryResult))
            .digest('hex')
            .substring(0, 16);

          // Store the full query result locally
          let dataSummary: DataSummary | undefined;
          try {
            // queryResult should be an array of records from VDS
            const dataArray = Array.isArray(queryResult) ? queryResult : [queryResult];

            // Store the full result
            const storedResult = await storeQueryResult({
              data: dataArray as Record<string, unknown>[],
              datasourceLuid,
              queryPurpose: claim,
            });

            // Analyze the result
            const analysis = analyzeQueryResult(dataArray as Record<string, unknown>[]);

            dataSummary = {
              rowCount: analysis.rowCount,
              columnCount: analysis.columnCount,
              columns: analysis.columns,
              sampleRows: analysis.sampleRows,
              storageId: storedResult.id,
            };
          } catch (error) {
            // If storage/analysis fails, continue without dataSummary
            console.error('Failed to store/analyze query result:', error);
          }

          const fact: Fact = {
            id: randomUUID(),
            claim,
            evidence: {
              type: 'query',
              datasourceLuid,
              query,
              resultHash,
              retrievedAt: new Date().toISOString(),
              dataSummary,
            },
            confidence,
          };

          session.factStore.push(fact);

          // Add to query history
          session.queryHistory.push({
            id: randomUUID(),
            timestamp: new Date().toISOString(),
            datasourceLuid,
            query,
            purpose: claim,
            producedFacts: [fact.id],
          });

          analysisSessionStore.touch(sessionId);

          return new Ok({
            message: 'Fact added',
            factId: fact.id,
            totalFacts: session.factStore.length,
          });
        },
        constrainSuccessResult: (result) => ({ type: 'success', result }),
        getErrorText: (error) => `Analysis session not found: ${error.sessionId}`,
      });
    },
  });

  return tool;
};
