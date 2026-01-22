import { randomUUID } from 'crypto';
import { z } from 'zod';

// Hypothesis lifecycle
export const hypothesisSchema = z.object({
  statement: z.string().optional(),
  status: z.enum(['unformed', 'forming', 'testing', 'confirmed', 'refuted', 'revised']),
  history: z
    .array(
      z.object({
        statement: z.string(),
        timestamp: z.string().datetime(),
        reason: z.string(),
      }),
    )
    .default([]),
});

// Column statistics from data analysis
export const columnStatsSchema = z.object({
  name: z.string(),
  type: z.enum(['dimension', 'measure', 'unknown']),
  distinctCount: z.number(),
  distinctValues: z.array(z.string()).optional(), // Only for low-cardinality dimensions
  numericStats: z
    .object({
      min: z.number(),
      max: z.number(),
      avg: z.number(),
      sum: z.number(),
    })
    .optional(),
  sampleValues: z.array(z.string()),
});

// Data summary from analysis (works for both CSV and JSON query results)
export const dataSummarySchema = z.object({
  rowCount: z.number(),
  columnCount: z.number(),
  columns: z.array(columnStatsSchema),
  sampleRows: z.array(z.record(z.string())),
  storageId: z.string(), // Pointer to full data stored on server (CSV or JSON)
});

// Evidence source - either from a query or from a workbook view
export const queryEvidenceSchema = z.object({
  type: z.literal('query'),
  datasourceLuid: z.string(),
  query: z.record(z.any()), // VDS query object
  resultHash: z.string(), // Fingerprint for cache validation
  retrievedAt: z.string().datetime(),
  // Enhanced: actual data summary from the query result
  dataSummary: dataSummarySchema.optional(),
});

export const viewEvidenceSchema = z.object({
  type: z.literal('view'),
  workbookId: z.string(),
  workbookName: z.string(),
  viewId: z.string(),
  viewName: z.string(),
  viewDescription: z.string().optional(),
  datasourceLuids: z.array(z.string()).default([]), // Datasources used by this view
  importedAt: z.string().datetime(),
  // Enhanced: actual data from the view
  dataSummary: dataSummarySchema.optional(),
  dataFetchError: z.string().optional(), // If data fetch failed, record why
});

export const evidenceSchema = z.discriminatedUnion('type', [
  queryEvidenceSchema,
  viewEvidenceSchema,
]);

// Fact with evidence chain - can come from queries OR pre-built workbook views
export const factSchema = z.object({
  id: z.string().uuid(),
  claim: z.string(),
  evidence: evidenceSchema,
  confidence: z.enum(['verified', 'inferred', 'assumed', 'curated']), // 'curated' = from published workbook
  supersededBy: z.string().uuid().optional(),
});

// Explicit assumption
export const assumptionSchema = z.object({
  id: z.string().uuid(),
  statement: z.string(),
  category: z.enum(['data_quality', 'business_logic', 'temporal', 'scope']),
  status: z.enum(['active', 'validated', 'violated']),
  validationQuery: z.record(z.any()).optional(),
});

// Query history entry
export const queryHistoryEntrySchema = z.object({
  id: z.string().uuid(),
  timestamp: z.string().datetime(),
  datasourceLuid: z.string(),
  query: z.record(z.any()),
  purpose: z.string(),
  producedFacts: z.array(z.string().uuid()).default([]),
});

// Workbook scope entry
export const workbookScopeSchema = z.object({
  workbookId: z.string(),
  workbookName: z.string(),
  viewIds: z.array(z.string()).default([]), // Specific views in scope, empty = all views
});

// Scope boundaries
export const scopeSchema = z.object({
  datasources: z.array(z.string()).default([]), // Datasource LUIDs
  workbooks: z.array(workbookScopeSchema).default([]),
  timeRange: z
    .object({
      field: z.string().optional(),
      start: z.string().optional(),
      end: z.string().optional(),
    })
    .optional(),
  filters: z.array(z.record(z.any())).default([]),
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
  ttlMs: z.number().default(3600000), // 1 hour default
});

export type AnalysisSession = z.infer<typeof analysisSessionSchema>;
export type Hypothesis = z.infer<typeof hypothesisSchema>;
export type Fact = z.infer<typeof factSchema>;
export type Evidence = z.infer<typeof evidenceSchema>;
export type QueryEvidence = z.infer<typeof queryEvidenceSchema>;
export type ViewEvidence = z.infer<typeof viewEvidenceSchema>;
export type Assumption = z.infer<typeof assumptionSchema>;
export type QueryHistoryEntry = z.infer<typeof queryHistoryEntrySchema>;
export type WorkbookScope = z.infer<typeof workbookScopeSchema>;
export type Scope = z.infer<typeof scopeSchema>;
export type ColumnStats = z.infer<typeof columnStatsSchema>;
export type DataSummary = z.infer<typeof dataSummarySchema>;

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
    ttlMs: 3600000,
  };
}
