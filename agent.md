# Analytics Session Implementation Project

## Project Overview

This agent configuration is for implementing the **AnalysisSession** resource in the Tableau MCP Server. The goal is to transform Tableau MCP from a stateless API wrapper into an **analytics agent harness** that provides domain-specific primitives for analytical workflows.

**Repository:** https://github.com/tableau/tableau-mcp
**Target Branch:** Create a new feature branch from `main`

## Problem Statement

The current Tableau MCP Server is conceptually stateless. Each tool call is independent, with no memory of:
- What the user was trying to analyze (hypothesis)
- What data is already available or what data has already been retrieved (facts established)
- What assumptions were made (assumptions registry)
- What queries have been executed (analytical lineage)

This puts the entire burden of "context engineering" on the LLM's context window, which is token-limited, expensive, and prone to drift/hallucination over long analytical sessions.

## Solution: AnalysisSession Resource

Implement a new **AnalysisSession** resource that tracks analytical state across tool calls, enabling:
1. Hypothesis lifecycle management
2. Fact accumulation with data lineage
3. Assumption tracking with validation
4. Scope boundaries for analytical sessions
5. Query history for audit/replay

## Architecture Context

### Current Codebase Structure

```
src/
├── server.ts           # MCP server wrapper (Server class extends McpServer)
├── sessions.ts         # THIN session management (transport + clientInfo only)
├── config.ts           # Environment-based configuration
├── restApiInstance.ts  # Tableau REST/VDS API client factory
├── tools/
│   ├── tool.ts         # Base Tool class
│   ├── tools.ts        # Tool factory registry
│   ├── toolName.ts     # Tool name constants and types
│   └── [tool folders]  # Individual tool implementations
└── server/
    └── express.ts      # HTTP transport setup
```

### Current Session Object (sessions.ts)

The existing Session type is minimal:
```typescript
export type Session = {
  transport: StreamableHTTPServerTransport;
  clientInfo: ClientInfo;
};
```

This needs to be extended to include AnalysisSession state.

### Tool Implementation Pattern

Tools follow this factory pattern (see `src/tools/queryDatasource/queryDatasource.ts`):
```typescript
export const getQueryDatasourceTool = (
  server: Server,
  authInfo?: TableauAuthInfo,
): Tool<typeof paramsSchema> => {
  return new Tool({
    server,
    name: 'query-datasource',
    description: '...',
    paramsSchema,
    annotations: { ... },
    argsValidator: validateQuery,
    callback: async ({ args }, { requestId, authInfo, signal }) => {
      // Implementation
    },
  });
};
```

## Implementation Specification

> **Note:** This implementation follows the existing codebase patterns including:
> - Tool callbacks use `logAndExecute` with `ts-results-es` Result types
> - All tools return `CallToolResult` via the Tool class infrastructure
> - Schema definitions follow Zod patterns established in the codebase

### Phase 1: Core AnalysisSession Resource

#### 1.1 Create `src/resources/analysisSession.ts`

```typescript
import { z } from 'zod';
import { randomUUID } from 'crypto';

// Hypothesis lifecycle
export const hypothesisSchema = z.object({
  statement: z.string().optional(),
  status: z.enum(['unformed', 'forming', 'testing', 'confirmed', 'refuted', 'revised']),
  history: z.array(z.object({
    statement: z.string(),
    timestamp: z.string().datetime(),
    reason: z.string()
  })).default([])
});

// Evidence source - either from a query or from a workbook view
export const queryEvidenceSchema = z.object({
  type: z.literal('query'),
  datasourceLuid: z.string(),
  query: z.record(z.any()), // VDS query object
  resultHash: z.string(),
  retrievedAt: z.string().datetime()
});

export const viewEvidenceSchema = z.object({
  type: z.literal('view'),
  workbookId: z.string(),
  workbookName: z.string(),
  viewId: z.string(),
  viewName: z.string(),
  viewDescription: z.string().optional(),
  datasourceLuids: z.array(z.string()).default([]), // Datasources used by this view
  importedAt: z.string().datetime()
});

export const evidenceSchema = z.discriminatedUnion('type', [
  queryEvidenceSchema,
  viewEvidenceSchema
]);

// Fact with evidence chain - can come from queries OR pre-built workbook views
export const factSchema = z.object({
  id: z.string().uuid(),
  claim: z.string(),
  evidence: evidenceSchema,
  confidence: z.enum(['verified', 'inferred', 'assumed', 'curated']), // 'curated' = from published workbook
  supersededBy: z.string().uuid().optional()
});

// Explicit assumption
export const assumptionSchema = z.object({
  id: z.string().uuid(),
  statement: z.string(),
  category: z.enum(['data_quality', 'business_logic', 'temporal', 'scope']),
  status: z.enum(['active', 'validated', 'violated']),
  validationQuery: z.record(z.any()).optional()
});

// Query history entry
export const queryHistoryEntrySchema = z.object({
  id: z.string().uuid(),
  timestamp: z.string().datetime(),
  datasourceLuid: z.string(),
  query: z.record(z.any()),
  purpose: z.string(),
  producedFacts: z.array(z.string().uuid()).default([])
});

// Scope boundaries
export const scopeSchema = z.object({
  datasources: z.array(z.string()).default([]), // Datasource LUIDs
  workbooks: z.array(z.object({
    workbookId: z.string(),
    workbookName: z.string(),
    viewIds: z.array(z.string()).default([]) // Specific views in scope, empty = all views
  })).default([]),
  timeRange: z.object({
    field: z.string().optional(),
    start: z.string().optional(),
    end: z.string().optional()
  }).optional(),
  filters: z.array(z.record(z.any())).default([])
});

// Full AnalysisSession
export const analysisSessionSchema = z.object({
  sessionId: z.string().uuid(),
  name: z.string().optional(),
  hypothesis: hypothesisSchema.default({ status: 'unformed', history: [] }),
  factStore: z.array(factSchema).default([]),
  assumptions: z.array(assumptionSchema).default([]),
  scope: scopeSchema.default({ datasources: [], workbooks: [], filters: [] }),
  queryHistory: z.array(queryHistoryEntrySchema).default([]),
  createdAt: z.string().datetime(),
  lastActivityAt: z.string().datetime(),
  ttlMs: z.number().default(3600000) // 1 hour default
});

export type AnalysisSession = z.infer<typeof analysisSessionSchema>;
export type Hypothesis = z.infer<typeof hypothesisSchema>;
export type Fact = z.infer<typeof factSchema>;
export type Evidence = z.infer<typeof evidenceSchema>;
export type QueryEvidence = z.infer<typeof queryEvidenceSchema>;
export type ViewEvidence = z.infer<typeof viewEvidenceSchema>;
export type Assumption = z.infer<typeof assumptionSchema>;
export type QueryHistoryEntry = z.infer<typeof queryHistoryEntrySchema>;
export type Scope = z.infer<typeof scopeSchema>;

// Factory function
export function createAnalysisSession(name?: string): AnalysisSession {
  const now = new Date().toISOString();
  return {
    sessionId: randomUUID(),
    name,
    hypothesis: { status: 'unformed', history: [] },
    factStore: [],
    assumptions: [],
    scope: { datasources: [], workbooks: [], filters: [] },
    queryHistory: [],
    createdAt: now,
    lastActivityAt: now,
    ttlMs: 3600000
  };
}
```

#### 1.2 Create `src/resources/analysisSessionStore.ts`

```typescript
import { AnalysisSession, createAnalysisSession } from './analysisSession.js';

// In-memory store (prototype - not production-ready for multi-tenant use)
const analysisSessions: Map<string, AnalysisSession> = new Map();

export const analysisSessionStore = {
  create(name?: string): AnalysisSession {
    const session = createAnalysisSession(name);
    analysisSessions.set(session.sessionId, session);
    return session;
  },

  // Pure getter - does not mutate state
  get(sessionId: string): AnalysisSession | undefined {
    return analysisSessions.get(sessionId);
  },

  // Check if session is expired
  isExpired(session: AnalysisSession): boolean {
    const elapsed = Date.now() - new Date(session.lastActivityAt).getTime();
    return elapsed > session.ttlMs;
  },

  // Get session if valid (not expired), returns undefined if expired or not found
  getIfValid(sessionId: string): AnalysisSession | undefined {
    const session = this.get(sessionId);
    if (!session) return undefined;
    if (this.isExpired(session)) {
      this.delete(sessionId);
      return undefined;
    }
    return session;
  },

  // Explicitly update last activity time
  touch(sessionId: string): void {
    const session = this.get(sessionId);
    if (session) {
      session.lastActivityAt = new Date().toISOString();
    }
  },

  update(sessionId: string, updates: Partial<AnalysisSession>): AnalysisSession | undefined {
    const session = this.getIfValid(sessionId);
    if (!session) return undefined;
    
    Object.assign(session, updates, { lastActivityAt: new Date().toISOString() });
    return session;
  },

  delete(sessionId: string): boolean {
    return analysisSessions.delete(sessionId);
  },

  list(): AnalysisSession[] {
    // Clean up expired sessions during list
    this.cleanupExpired();
    return Array.from(analysisSessions.values());
  },

  // Periodic cleanup of expired sessions
  cleanupExpired(): void {
    for (const [id, session] of analysisSessions) {
      if (this.isExpired(session)) {
        analysisSessions.delete(id);
      }
    }
  }
};
```

### Phase 2: Analysis Session Tools

> **Pattern Note:** All tools follow the established `logAndExecute` pattern with `ts-results-es` Result types.
> Tools that don't require REST API calls use a simplified pattern with `Ok()` returns.

#### 2.1 Create `src/tools/analysisSession/createAnalysisSession.ts`

```typescript
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { Server } from '../../server.js';
import { Tool } from '../tool.js';
import { analysisSessionStore } from '../../resources/analysisSessionStore.js';
import { AnalysisSession } from '../../resources/analysisSession.js';

const paramsSchema = {
  name: z.string().optional().describe('Optional name for the analysis session'),
  initialHypothesis: z.string().optional().describe('Initial hypothesis to test'),
  datasources: z.array(z.string()).optional().describe('Datasource LUIDs to include in scope'),
  workbooks: z.array(z.string()).optional().describe('Workbook IDs to include in scope. Views from these workbooks can be imported as pre-established facts.'),
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
    `,
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
              history: [{
                statement: initialHypothesis,
                timestamp: new Date().toISOString(),
                reason: 'Initial hypothesis'
              }]
            };
          }
          
          if (datasources && datasources.length > 0) {
            session.scope.datasources = datasources;
          }
          
          if (workbooks && workbooks.length > 0) {
            session.scope.workbooks = workbooks.map(id => ({
              workbookId: id,
              workbookName: '', // Will be populated on first access
              viewIds: []
            }));
          }
          
          return new Ok({
            sessionId: session.sessionId,
            message: 'Analysis session created',
            hypothesis: session.hypothesis,
            scope: session.scope,
            hint: workbooks?.length 
              ? 'Use import-workbook-facts to import pre-built analytical facts from the scoped workbooks.' 
              : undefined
          });
        },
        constrainSuccessResult: (result) => ({ type: 'success', result }),
      });
    },
  });

  return tool;
};
```

#### 2.2 Create `src/tools/analysisSession/getAnalysisSession.ts`

```typescript
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Err, Ok } from 'ts-results-es';
import { z } from 'zod';

import { Server } from '../../server.js';
import { Tool } from '../tool.js';
import { analysisSessionStore } from '../../resources/analysisSessionStore.js';
import { AnalysisSession } from '../../resources/analysisSession.js';

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
    `,
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
```

#### 2.3 Create `src/tools/analysisSession/deleteAnalysisSession.ts`

```typescript
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Err, Ok } from 'ts-results-es';
import { z } from 'zod';

import { Server } from '../../server.js';
import { Tool } from '../tool.js';
import { analysisSessionStore } from '../../resources/analysisSessionStore.js';

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
    `,
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
```

#### 2.4 Create `src/tools/analysisSession/updateHypothesis.ts`

```typescript
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Err, Ok } from 'ts-results-es';
import { z } from 'zod';

import { Server } from '../../server.js';
import { Tool } from '../tool.js';
import { analysisSessionStore } from '../../resources/analysisSessionStore.js';
import { Hypothesis } from '../../resources/analysisSession.js';

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
    `,
    paramsSchema,
    annotations: {
      title: 'Update Hypothesis',
      readOnlyHint: false,
      openWorldHint: false,
    },
    callback: async ({ sessionId, hypothesis, status, reason }, { requestId, authInfo }): Promise<CallToolResult> => {
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
              reason: `Superseded: ${reason}`
            });
          }
          
          // Update to new hypothesis
          session.hypothesis.statement = hypothesis;
          session.hypothesis.status = status;
          
          // Record the new hypothesis in history
          session.hypothesis.history.push({
            statement: hypothesis,
            timestamp: new Date().toISOString(),
            reason
          });
          
          analysisSessionStore.touch(sessionId);
          
          return new Ok({
            message: 'Hypothesis updated',
            hypothesis: session.hypothesis
          });
        },
        constrainSuccessResult: (result) => ({ type: 'success', result }),
        getErrorText: (error) => `Analysis session not found: ${error.sessionId}`,
      });
    },
  });

  return tool;
};
```

#### 2.5 Create `src/tools/analysisSession/addFact.ts`

```typescript
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Err, Ok } from 'ts-results-es';
import { z } from 'zod';
import { randomUUID, createHash } from 'crypto';

import { Server } from '../../server.js';
import { Tool } from '../tool.js';
import { analysisSessionStore } from '../../resources/analysisSessionStore.js';
import { Fact } from '../../resources/analysisSession.js';

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
    `,
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
          
          const fact: Fact = {
            id: randomUUID(),
            claim,
            evidence: {
              type: 'query',
              datasourceLuid,
              query,
              resultHash,
              retrievedAt: new Date().toISOString()
            },
            confidence
          };
          
          session.factStore.push(fact);
          
          // Add to query history
          session.queryHistory.push({
            id: randomUUID(),
            timestamp: new Date().toISOString(),
            datasourceLuid,
            query,
            purpose: claim,
            producedFacts: [fact.id]
          });
          
          analysisSessionStore.touch(sessionId);
          
          return new Ok({
            message: 'Fact added',
            factId: fact.id,
            totalFacts: session.factStore.length
          });
        },
        constrainSuccessResult: (result) => ({ type: 'success', result }),
        getErrorText: (error) => `Analysis session not found: ${error.sessionId}`,
      });
    },
  });

  return tool;
};
```

#### 2.6 Create `src/tools/analysisSession/addAssumption.ts`

```typescript
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Err, Ok } from 'ts-results-es';
import { z } from 'zod';
import { randomUUID } from 'crypto';

import { Server } from '../../server.js';
import { Tool } from '../tool.js';
import { analysisSessionStore } from '../../resources/analysisSessionStore.js';
import { Assumption } from '../../resources/analysisSession.js';

const paramsSchema = {
  sessionId: z.string().uuid(),
  statement: z.string().describe('The assumption being made'),
  category: z.enum(['data_quality', 'business_logic', 'temporal', 'scope']),
  validationQuery: z.record(z.any()).optional().describe('Optional query to validate this assumption'),
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
    `,
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
            validationQuery
          };
          
          session.assumptions.push(assumption);
          analysisSessionStore.touch(sessionId);
          
          return new Ok({
            message: 'Assumption recorded',
            assumptionId: assumption.id,
            totalAssumptions: session.assumptions.length
          });
        },
        constrainSuccessResult: (result) => ({ type: 'success', result }),
        getErrorText: (error) => `Analysis session not found: ${error.sessionId}`,
      });
    },
  });

  return tool;
};
```

#### 2.7 Create `src/tools/analysisSession/summarizeSession.ts`

```typescript
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Err, Ok } from 'ts-results-es';
import { z } from 'zod';

import { Server } from '../../server.js';
import { Tool } from '../tool.js';
import { analysisSessionStore } from '../../resources/analysisSessionStore.js';

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
    `,
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
              lastActivity: session.lastActivityAt
            },
            hypothesis: {
              current: session.hypothesis.statement,
              status: session.hypothesis.status,
              evolutionCount: session.hypothesis.history.length
            },
            facts: {
              total: session.factStore.length,
              byConfidence: {
                curated: session.factStore.filter(f => f.confidence === 'curated').length,
                verified: session.factStore.filter(f => f.confidence === 'verified').length,
                inferred: session.factStore.filter(f => f.confidence === 'inferred').length,
                assumed: session.factStore.filter(f => f.confidence === 'assumed').length
              },
              bySource: {
                fromQueries: session.factStore.filter(f => f.evidence.type === 'query').length,
                fromWorkbooks: session.factStore.filter(f => f.evidence.type === 'view').length
              },
              claims: session.factStore.map(f => f.claim)
            },
            assumptions: {
              total: session.assumptions.length,
              active: session.assumptions.filter(a => a.status === 'active').length,
              byCategory: {
                data_quality: session.assumptions.filter(a => a.category === 'data_quality').length,
                business_logic: session.assumptions.filter(a => a.category === 'business_logic').length,
                temporal: session.assumptions.filter(a => a.category === 'temporal').length,
                scope: session.assumptions.filter(a => a.category === 'scope').length
              },
              statements: session.assumptions.filter(a => a.status === 'active').map(a => a.statement)
            },
            scope: {
              datasourcesAnalyzed: session.scope.datasources.length,
              workbooksInScope: session.scope.workbooks.length,
              viewsImported: session.scope.workbooks.reduce((sum, w) => sum + w.viewIds.length, 0),
              timeRange: session.scope.timeRange,
              filtersApplied: session.scope.filters.length
            },
            queries: {
              total: session.queryHistory.length,
              datasourcesCovered: [...new Set(session.queryHistory.map(q => q.datasourceLuid))].length
            }
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
```

#### 2.8 Create `src/tools/analysisSession/importWorkbookFacts.ts`

```typescript
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Err, Ok } from 'ts-results-es';
import { z } from 'zod';
import { randomUUID } from 'crypto';

import { getConfig } from '../../config.js';
import { useRestApi } from '../../restApiInstance.js';
import { Server } from '../../server.js';
import { getTableauAuthInfo } from '../../server/oauth/getTableauAuthInfo.js';
import { Tool } from '../tool.js';
import { analysisSessionStore } from '../../resources/analysisSessionStore.js';
import { Fact, ViewEvidence } from '../../resources/analysisSession.js';

const paramsSchema = {
  sessionId: z.string().uuid(),
  workbookId: z.string().describe('The workbook ID to import facts from'),
  viewIds: z.array(z.string()).optional().describe('Specific view IDs to import. If omitted, all views are imported.'),
  generateClaims: z.boolean().default(true).describe('If true, generate claim statements from view names/descriptions'),
};

type ImportError = 
  | { type: 'session-not-found'; sessionId: string }
  | { type: 'workbook-fetch-failed'; workbookId: string };

type ImportResult = {
  message: string;
  workbookId: string;
  workbookName: string;
  factsImported: Array<{ factId: string; claim: string; viewName: string }>;
  totalSessionFacts: number;
};

export const getImportWorkbookFactsTool = (server: Server): Tool<typeof paramsSchema> => {
  const tool = new Tool({
    server,
    name: 'import-workbook-facts',
    description: `
      Imports pre-built analytical facts from a Tableau workbook's views.
      
      Workbook views represent curated analytical artifacts created by analysts.
      Each view encapsulates:
      - A specific analytical perspective or question
      - Pre-configured filters, calculations, and aggregations
      - Visual design choices that communicate analytical intent
      
      By importing views as facts, the session gains access to established
      analytical conclusions without needing to reconstruct them from raw queries.
      
      Imported facts have confidence level 'curated' to indicate they come from
      published, presumably validated analytical work.
      
      Use this after creating a session with workbooks in scope.
    `,
    paramsSchema,
    annotations: {
      title: 'Import Workbook Facts',
      readOnlyHint: false,
      openWorldHint: false,
    },
    callback: async (
      { sessionId, workbookId, viewIds, generateClaims },
      { requestId, authInfo, signal },
    ): Promise<CallToolResult> => {
      const config = getConfig();
      
      return await tool.logAndExecute<ImportResult, ImportError>({
        requestId,
        authInfo,
        args: { sessionId, workbookId, viewIds, generateClaims },
        callback: async () => {
          const session = analysisSessionStore.getIfValid(sessionId);
          if (!session) {
            return new Err({ type: 'session-not-found', sessionId });
          }
          
          return await useRestApi({
            config,
            requestId,
            server,
            jwtScopes: ['tableau:content:read'],
            signal,
            authInfo: getTableauAuthInfo(authInfo),
            callback: async (restApi) => {
              const workbook = await restApi.workbooksMethods.getWorkbook({
                workbookId,
                siteId: restApi.siteId,
              });
              
              const views = workbook.views?.view || [];
              
              // Filter to specific views if requested
              const viewsToImport = viewIds?.length 
                ? views.filter(v => viewIds.includes(v.id))
                : views;
              
              const importedFacts: Array<{ factId: string; claim: string; viewName: string }> = [];
              const now = new Date().toISOString();
              
              for (const view of viewsToImport) {
                const claim = generateClaims
                  ? `Analysis: ${view.name}${view.description ? ` - ${view.description}` : ''}`
                  : view.name;
                
                const evidence: ViewEvidence = {
                  type: 'view',
                  workbookId: workbook.id,
                  workbookName: workbook.name,
                  viewId: view.id,
                  viewName: view.name,
                  viewDescription: view.description,
                  datasourceLuids: [],
                  importedAt: now
                };
                
                const fact: Fact = {
                  id: randomUUID(),
                  claim,
                  evidence,
                  confidence: 'curated'
                };
                
                session.factStore.push(fact);
                importedFacts.push({
                  factId: fact.id,
                  claim: fact.claim,
                  viewName: view.name
                });
              }
              
              // Update workbook metadata in scope
              const scopeWorkbook = session.scope.workbooks.find(w => w.workbookId === workbookId);
              if (scopeWorkbook) {
                scopeWorkbook.workbookName = workbook.name;
                scopeWorkbook.viewIds = viewsToImport.map(v => v.id);
              } else {
                session.scope.workbooks.push({
                  workbookId: workbook.id,
                  workbookName: workbook.name,
                  viewIds: viewsToImport.map(v => v.id)
                });
              }
              
              analysisSessionStore.touch(sessionId);
              
              return new Ok({
                message: `Imported ${importedFacts.length} facts from workbook "${workbook.name}"`,
                workbookId: workbook.id,
                workbookName: workbook.name,
                factsImported: importedFacts,
                totalSessionFacts: session.factStore.length
              });
            },
          });
        },
        constrainSuccessResult: (result) => ({ type: 'success', result }),
        getErrorText: (error) => {
          switch (error.type) {
            case 'session-not-found':
              return `Analysis session not found: ${error.sessionId}`;
            case 'workbook-fetch-failed':
              return `Failed to fetch workbook: ${error.workbookId}`;
          }
        },
      });
    },
  });

  return tool;
};
```

### Phase 3: Tool Registration

#### 3.1 Update `src/tools/toolName.ts`

Add the new tool names to `toolNames` array, add `'analysis-session'` to `toolGroupNames`, and add the group definition:

```typescript
export const toolNames = [
  // ... existing tools ...
  'create-analysis-session',
  'get-analysis-session',
  'delete-analysis-session',
  'update-hypothesis',
  'add-fact',
  'add-assumption',
  'import-workbook-facts',
  'summarize-analysis-session',
] as const;

export const toolGroupNames = [
  // ... existing group names ...
  'analysis-session',
] as const;

export const toolGroups = {
  // ... existing groups ...
  'analysis-session': [
    'create-analysis-session',
    'get-analysis-session',
    'delete-analysis-session',
    'update-hypothesis',
    'add-fact',
    'add-assumption',
    'import-workbook-facts',
    'summarize-analysis-session',
  ],
} as const satisfies Record<ToolGroupName, Array<ToolName>>;
```

#### 3.2 Update `src/tools/tools.ts`

```typescript
import { getCreateAnalysisSessionTool } from './analysisSession/createAnalysisSession.js';
import { getGetAnalysisSessionTool } from './analysisSession/getAnalysisSession.js';
import { getDeleteAnalysisSessionTool } from './analysisSession/deleteAnalysisSession.js';
import { getUpdateHypothesisTool } from './analysisSession/updateHypothesis.js';
import { getAddFactTool } from './analysisSession/addFact.js';
import { getAddAssumptionTool } from './analysisSession/addAssumption.js';
import { getImportWorkbookFactsTool } from './analysisSession/importWorkbookFacts.js';
import { getSummarizeSessionTool } from './analysisSession/summarizeSession.js';

export const toolFactories = [
  // ... existing tool factories ...
  getCreateAnalysisSessionTool,
  getGetAnalysisSessionTool,
  getDeleteAnalysisSessionTool,
  getUpdateHypothesisTool,
  getAddFactTool,
  getAddAssumptionTool,
  getImportWorkbookFactsTool,
  getSummarizeSessionTool,
];
```

### Phase 4: Testing

Create tests in `src/tools/analysisSession/*.test.ts` following the existing patterns in the codebase.

Key test scenarios:
1. Session lifecycle (create, get, delete, expire)
2. Hypothesis evolution tracking
3. Fact accumulation with query evidence linking
4. Workbook fact import with view evidence
5. Mixed facts (query + view) in single session
6. Assumption recording and categorization
7. Summary generation with all evidence types
8. Scope tracking with datasources and workbooks
9. Session expiration (TTL enforcement)
10. Error handling for not-found sessions

## Implementation Guidelines

### Coding Standards
- Follow existing patterns in the codebase
- Use Zod for all schema validation
- Use ts-results-es for Result types
- Follow the Tool class pattern for all new tools
- Add appropriate annotations (readOnlyHint, openWorldHint)

### Error Handling
- Return structured errors through the Tool.logAndExecute pattern
- Include requestId in error responses
- Handle session expiration gracefully

### Logging
- Use the existing log utility from `src/logging/log.ts`
- Log session lifecycle events at info level
- Log state changes at debug level

## Success Criteria

1. All new tools pass unit tests
2. Integration tests demonstrate multi-step analytical workflows
3. Session state persists correctly across tool calls
4. Expired sessions are cleaned up properly
5. Tool descriptions are clear enough for LLMs to use correctly

## Future Considerations (Out of Scope for Initial Implementation)

- Persistent session storage (Redis, database)
- Session sharing between users
- Export/import session state
- Integration with query-datasource for automatic fact registration
- Validation query execution for assumptions

## Context Materials

The original analysis that motivated this implementation is documented in the main strategy session. Key insights:

1. **The Gap:** Current Tableau MCP is stateless, putting all context burden on the LLM
2. **The Opportunity:** Domain-specific analytical primitives that generic agent frameworks won't provide
3. **The Moat:** Deep integration with Tableau's semantic model, governance, and security

This implementation creates the foundation for Tableau MCP to become an "analytics agent harness" rather than just an API wrapper.
