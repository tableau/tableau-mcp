import { z } from 'zod';

import { luidSchema } from '../../routeSafety/ids.js';

const metadataId = z.string().min(1).max(2048).describe('Opaque Metadata API ID, not a REST LUID.');
const text = z.string().min(1).max(1024);

export const lineageSourceSchema = z.union([
  z.object({ type: z.literal('column'), id: metadataId }),
  z.object({
    type: z.literal('column'),
    name: text.describe('Exact database column name.'),
    table: text.describe('Exact table name; qualify with database/schema when ambiguous.'),
    database: text.optional(),
    schema: text.optional(),
  }),
  z.object({ type: z.literal('field'), id: metadataId }),
  z.object({ type: z.literal('datasource'), luid: luidSchema }),
  z.object({ type: z.literal('flow'), luid: luidSchema }),
  z.object({ type: z.literal('flow-input-field'), id: metadataId }),
  z.object({ type: z.literal('flow-output-field'), id: metadataId }),
  z.object({ type: z.literal('flow-output-step'), id: metadataId }),
  z.object({ type: z.literal('prep-step'), flowLuid: luidSchema, stepId: text }),
  z.object({
    type: z.literal('prep-field'),
    flowLuid: luidSchema,
    stepId: text,
    name: text,
    namespace: text.optional(),
  }),
]);

export const dataLineageParams = {
  source: lineageSourceSchema.describe('The exact column, field, content, or native-flow origin.'),
  direction: z
    .enum(['upstream', 'downstream', 'both'])
    .default('downstream')
    .describe('Traversal direction.'),
  includePrepDetails: z
    .boolean()
    .default(false)
    .describe(
      'Read optional sanitized Flow Document API JSON (2026.3+, endpoint availability and download permission; Server requires features.getFlowDocumentRestApi).',
    ),
  maxDepth: z
    .number()
    .int()
    .min(1)
    .max(12)
    .default(5)
    .describe(
      'Maximum Metadata relationship depth. Prep analysis uses bounded node/version counts.',
    ),
  maxNodes: z
    .number()
    .int()
    .min(1)
    .max(500)
    .default(100)
    .describe('Maximum returned graph nodes, including document nodes.'),
  maxEdges: z
    .number()
    .int()
    .min(1)
    .max(2000)
    .default(300)
    .describe('Maximum returned relationships.'),
  maxRequests: z
    .number()
    .int()
    .min(1)
    .max(200)
    .default(40)
    .describe('Maximum Metadata and flow-download requests combined.'),
  pageSize: z.number().int().min(1).max(100).default(25).describe('Metadata connection page size.'),
};

export type LineageSource = z.infer<typeof lineageSourceSchema>;
export type LineageOptions = z.infer<z.ZodObject<typeof dataLineageParams>>;
export type LineageKind =
  | 'column'
  | 'field'
  | 'datasource'
  | 'flow'
  | 'flow-input-field'
  | 'flow-output-field'
  | 'flow-output-step'
  | 'sheet'
  | 'dashboard'
  | 'workbook'
  | 'prep-step'
  | 'prep-field';
export type EvidenceLevel = 'direct' | 'possible' | 'unknown';

export type LineageNode = {
  id: string;
  kind: LineageKind;
  name?: string;
  metadataId?: string;
  luid?: string;
  metadataType?: string;
  dataType?: string;
  formula?: string;
  stepId?: string;
  operation?: string;
  flowLuid?: string;
  documentPath?: string;
  table?: { name?: string; schema?: string; database?: string };
};

export type LineageEdge = {
  id: string;
  from: string;
  to: string;
  relationship: string;
  evidence: EvidenceLevel;
  provenance: 'metadata-api' | 'flow-document';
  // Container membership is terminal: expanding it would attribute every
  // unrelated field/sheet in the same container to the original column.
  propagates: boolean;
};

export type LineageWarning = { code: string; message: string; nodeId?: string };

export type DataLineageResult = {
  resolution: 'resolved' | 'ambiguous' | 'not-found' | 'unavailable' | 'not-allowed';
  sourceId?: string;
  candidates?: LineageNode[];
  direction: LineageOptions['direction'];
  nodes: LineageNode[];
  edges: LineageEdge[];
  warnings: LineageWarning[];
  prepDetails?: Array<{
    flowLuid: string;
    // Syntactic references remain local to each operation. They are not joined
    // to catalog column IDs or other steps by name.
    fieldAnalysis?: {
      versionCount: number;
      issues: Array<{ code: string; path: string }>;
      truncated: boolean;
    };
    operations: Array<{
      path: string[];
      parentStepId: string;
      operationId?: string;
      operation: string;
      expression?: string;
      references: string[];
      outputs: string[];
      removes?: string[];
      rename?: { from: string; to: string };
      conditions?: Array<{ leftExpression: string; rightExpression: string; comparator?: string }>;
      aggregates?: Array<{ columnName: string; function?: string; newColumnName?: string }>;
      groupBy?: string[];
      status: 'references-extracted' | 'unknown';
    }>;
  }>;
  coverage: {
    metadata: 'indexed-visible-subgraph' | 'partial' | 'unavailable';
    prep: 'not-requested' | 'static-fields-with-gaps' | 'unavailable';
    truncated: boolean;
    requests: number;
    permissionMode: 'FILTER' | 'FILTER_WITH_VERIFIED_PREP_INPUTS';
  };
  limitations: string[];
};

export type DataImpact = {
  nodeId: string;
  classification: EvidenceLevel | 'indirect';
  path: { nodeIds: string[]; edgeIds: string[] };
};
