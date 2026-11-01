import { z } from 'zod';

import { luidSchema } from '../../routeSafety/ids.js';

const metadataId = z.string().min(1).max(2048).describe('Opaque Metadata API ID, not a REST LUID.');
const text = z.string().min(1).max(1024);

export const prepSchemaObservation = z
  .object({
    documentSha256: z.string().regex(/^[a-f0-9]{64}$/),
    nodeId: text,
    fields: z
      .array(
        z
          .object({
            name: text.refine((value) => value.trim().length > 0),
            type: z.enum(['boolean', 'date', 'datetime', 'integer', 'real', 'spatial', 'string']),
          })
          .strict(),
      )
      .max(5000),
  })
  .strict();
export type PrepSchemaObservation = z.infer<typeof prepSchemaObservation>;

export const lineageSourceSchema = z.union([
  z.object({
    type: z.literal('local-flow'),
    path: z
      .string()
      .min(1)
      .max(4096)
      .describe(
        'Absolute TFL/TFLX path inside operator-configured local flow roots. Self-hosted stdio only.',
      ),
    at: z
      .union([
        z.object({ type: z.literal('step'), stepId: text }),
        z.object({
          type: z.literal('field'),
          stepId: text,
          name: text,
          namespace: text.optional(),
        }),
      ])
      .optional()
      .describe(
        'Optional exact local step or output-field origin; otherwise analyze the whole file.',
      ),
  }),
  z.object({
    type: z.literal('database'),
    id: metadataId.describe('DatabaseServer, File or CloudFile Metadata API ID.'),
  }),
  z.object({ type: z.literal('table'), id: metadataId }),
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
  z.object({
    type: z.literal('datasource'),
    id: metadataId.describe('Published or embedded data-source Metadata API ID.'),
  }),
  z.object({ type: z.literal('workbook'), luid: luidSchema }),
  z.object({ type: z.literal('workbook'), id: metadataId }),
  z.object({ type: z.literal('sheet'), id: metadataId }),
  z.object({ type: z.literal('dashboard'), id: metadataId }),
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
  source: lineageSourceSchema.describe(
    'The exact external database/file/table, column, Tableau content/field, or native-flow origin.',
  ),
  direction: z
    .enum(['upstream', 'downstream', 'both'])
    .default('downstream')
    .describe('Traversal direction.'),
  includePrepDetails: z
    .boolean()
    .default(false)
    .describe(
      'Read optional sanitized Flow Document API JSON (2026.3+, endpoint availability and download permission).',
    ),
  observedPrepSchemas: z
    .array(prepSchemaObservation)
    .max(100)
    .superRefine((values, context) => {
      const ids = new Set<string>();
      if (values.reduce((total, value) => total + value.fields.length, 0) > 5000)
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Observed schemas exceed the 5000-field total limit.',
        });
      for (const value of values) {
        const key = JSON.stringify([value.documentSha256, value.nodeId]);
        if (
          ids.has(key) ||
          new Set(value.fields.map((field) => field.name)).size !== value.fields.length
        )
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Observed node identities and field names must be unique.',
          });
        ids.add(key);
      }
    })
    .optional()
    .describe(
      'Optional operator-observed input/script/model output schemas, bound to the exact documentSha256 returned in prepDetails. Observations establish schema context, not script/model execution or internal column dependencies.',
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
  | 'database'
  | 'table'
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
  fieldId?: string;
  operation?: string;
  flowLuid?: string;
  flowLuids?: string[];
  documentPath?: string;
  documentId?: string;
  table?: { name?: string; schema?: string; database?: string };
};

export type LineageEdge = {
  id: string;
  from: string;
  to: string;
  relationship: string;
  evidence: EvidenceLevel;
  provenance: 'metadata-api' | 'flow-document' | 'local-flow-file';
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
    flowLuid?: string;
    documentId?: string;
    source?: { kind: 'native-flow-file'; sha256: string; byteLength: number; name: string };
    // Syntactic references remain local to each operation. They are not joined
    // to catalog column IDs or other steps by name.
    fieldAnalysis?: {
      versionCount: number;
      issues: Array<{
        code: string;
        path: string;
        fieldName?: string;
        status?: 'broken' | 'unresolved';
      }>;
      truncated: boolean;
      catalogBindings?: {
        confirmed: number;
        unresolved: number;
        unresolvedReasons?: Record<string, number>;
      };
      schemaRequirements?: {
        documentSha256: string;
        nodes: Array<{ nodeId: string; nodeType: string }>;
      };
      appliedSchemaObservations?: number;
      catalogInputsAdded?: number;
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
    metadata: 'indexed-visible-subgraph' | 'partial' | 'unavailable' | 'not-requested';
    prep: 'not-requested' | 'static-fields-with-gaps' | 'unavailable';
    truncated: boolean;
    requests: number;
    permissionMode: 'FILTER' | 'FILTER_WITH_VERIFIED_PREP_INPUTS' | 'NOT_REQUESTED';
  };
  limitations: string[];
};

export type DataImpact = {
  nodeId: string;
  classification: EvidenceLevel | 'indirect';
  path: { nodeIds: string[]; edgeIds: string[] };
};
