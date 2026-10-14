import { Flow } from '../../../../sdks/tableau/types/flow.js';
import {
  FlowDocument,
  FlowDocumentConnection,
  FlowDocumentNode,
} from '../../../../sdks/tableau/types/flowDocument.js';

/**
 * Turns a raw, sanitized flow document into a compact,
 * LLM-friendly description of what the flow IS and DOES: its identity, the data
 * it reads (inputs + connections), the data it writes (outputs), the
 * transformation steps in between, the step-to-step lineage, and its parameters.
 *
 * The raw document is large, deeply nested, and full of layout/UI noise that is
 * useless (and expensive) for an LLM. This summarizer is intentionally
 * defensive: the experimental document format may evolve, so it reads only
 * well-known structural fields and degrades gracefully when they are absent.
 */

/**
 * A single data connection referenced by the flow, reduced to its descriptive
 * topology. All fields are optional because the experimental document does not
 * populate every attribute for every connection class (a file connection has a
 * `file` but no `server`/`database`, and vice versa). Credentials are stripped
 * server-side, so nothing sensitive appears here.
 */
export type FlowConnectionSummary = {
  id?: string;
  type?: string;
  class?: string;
  server?: string;
  port?: string;
  database?: string;
  schema?: string;
  warehouse?: string;
  file?: string;
  isPackaged?: boolean;
};

/** An input (data-source) step, with its resolved data connection when available. */
export type FlowInputSummary = {
  nodeId?: string;
  name?: string;
  nodeType?: string;
  role: string;
  connection?: FlowConnectionSummary;
};

/**
 * An output (write/publish) step. `target` holds whatever recognizable
 * destination details the node exposed (e.g. datasource/project/table name).
 */
export type FlowOutputSummary = {
  nodeId?: string;
  name?: string;
  nodeType?: string;
  role: string;
  target?: Record<string, string>;
};

/** A transformation step (join, filter, aggregate, calculation, …). */
export type FlowStepSummary = {
  nodeId?: string;
  name?: string;
  nodeType?: string;
  role: string;
};

/** A directed step-to-step edge (by step name) describing how data flows. */
export type FlowLineageEdge = { from: string; to: string };

/** A flow parameter (name, type, and current/default value). */
export type FlowParameterSummary = { name?: string; type?: string; value?: string };

/** The flow's catalog identity, enriched from Query Flow metadata when available. */
export type FlowIdentitySummary = {
  id?: string;
  name?: string;
  description?: string;
  project?: string;
  owner?: string;
  fileType?: string;
  updatedAt?: string;
  webpageUrl?: string;
  tags?: string[];
};

/**
 * A structured, non-fatal issue surfaced under `mcp.warnings`. Mirrors the
 * `GetFlowWarning` shape used by get-flow (type / severity / message /
 * affectedField) so the two flow tools report partial failures consistently.
 *
 * - `METADATA_FETCH_FAILED`: the best-effort Query Flow enrichment failed; the
 *   structural summary is still derived from the document.
 * - `EMPTY_DOCUMENT`: the document parsed but contained no recognizable steps
 *   (it may be empty, or the experimental format may have changed).
 */
export type DescribeFlowWarning =
  | {
      type: 'METADATA_FETCH_FAILED';
      severity: 'WARNING';
      message: string;
      affectedField: 'flow';
      httpStatus?: string;
    }
  | {
      type: 'EMPTY_DOCUMENT';
      severity: 'WARNING';
      message: string;
      affectedField: 'steps';
    };

/** The structured, LLM-friendly summary returned by the describe-flow tool. */
export type DescribeFlowResult = {
  flow: FlowIdentitySummary;
  stats: {
    nodeCount: number;
    inputCount: number;
    outputCount: number;
    transformCount: number;
    connectionCount: number;
  };
  inputs: FlowInputSummary[];
  outputs: FlowOutputSummary[];
  steps: FlowStepSummary[];
  lineage: FlowLineageEdge[];
  connections: FlowConnectionSummary[];
  parameters: FlowParameterSummary[];
  fields?: Record<string, Array<{ name?: string; type?: string }>>;
  mcp?: { warnings: DescribeFlowWarning[] };
};

type NodeCategory = 'input' | 'output' | 'transform';

// Friendly labels for the flow node types we recognize, keyed by the node's
// short type (the `.vN.` namespace stripped). Operation nodes appear with
// `Super`/`Simple` prefixes in real documents (e.g. `SuperJoin`, `SimpleUnion`),
// so `roleLabel` also looks up the prefix-stripped form. Anything still
// unmatched falls back to a humanized version of the raw type.
const NODE_ROLE_LABELS: Record<string, string> = {
  // Inputs
  LoadCsv: 'Input — CSV file',
  LoadCsvInputUnion: 'Input — CSV files (union)',
  LoadExcel: 'Input — Excel file',
  LoadExcelInputUnion: 'Input — Excel files (union)',
  LoadJson: 'Input — JSON file',
  LoadSql: 'Input — database table/query',
  LoadInitialSql: 'Input — database (custom SQL)',
  LoadDataSource: 'Input — published data source',
  LoadExtract: 'Input — extract',
  LoadSpatial: 'Input — spatial file',
  // Transforms (after Super/Simple normalization)
  Container: 'Clean step (prep operations)',
  Join: 'Join',
  Union: 'Union',
  Aggregate: 'Aggregate',
  Pivot: 'Pivot',
  Unpivot: 'Unpivot',
  Filter: 'Filter rows',
  AddColumn: 'Add column (calculation)',
  CalculatedField: 'Add column (calculation)',
  RemoveColumns: 'Remove columns',
  RenameColumn: 'Rename column',
  Group: 'Group / cluster values',
  ChangeColumnType: 'Change column type',
  Sample: 'Sample rows',
  Sort: 'Sort',
  SplitColumn: 'Split column',
  // Outputs
  PublishExtract: 'Output — published data source / extract',
  WriteToDatabase: 'Output — database table',
  WriteToCsv: 'Output — CSV file',
  WriteToHyper: 'Output — Hyper extract',
  WriteToFile: 'Output — file',
  Output: 'Output',
};

/** Strips the leading version namespace from a node type (".v1.LoadCsv" → "LoadCsv"). */
function shortType(t: string | undefined): string | undefined {
  if (!t) {
    return undefined;
  }
  const parts = t.split('.');
  return parts[parts.length - 1] || t;
}

/** "ChangeColumnType" → "Change Column Type". */
function humanize(s: string | undefined): string | undefined {
  if (!s) {
    return undefined;
  }
  return s
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .trim();
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function pickStrings(
  obj: Record<string, unknown> | undefined,
  keys: string[],
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!obj) {
    return out;
  }
  for (const key of keys) {
    const value = str(obj[key]);
    if (value !== undefined) {
      out[key] = value;
    }
  }
  return out;
}

/** Drops `undefined`, empty-array, and empty-object values so the JSON stays terse. */
function prune<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined) {
      continue;
    }
    if (Array.isArray(value) && value.length === 0) {
      continue;
    }
    if (
      typeof value === 'object' &&
      value !== null &&
      !Array.isArray(value) &&
      Object.keys(value as object).length === 0
    ) {
      continue;
    }
    out[key] = value;
  }
  return out as T;
}

/** Strips the `Super`/`Simple` operation-node prefix (`SuperJoin` → `Join`). */
function normalizeType(short: string | undefined): string | undefined {
  return short?.replace(/^(Super|Simple)/, '');
}

function roleLabel(short: string | undefined, category: NodeCategory): string {
  if (short && NODE_ROLE_LABELS[short]) {
    return NODE_ROLE_LABELS[short];
  }
  const normalized = normalizeType(short);
  if (normalized && NODE_ROLE_LABELS[normalized]) {
    return NODE_ROLE_LABELS[normalized];
  }
  const human = humanize(normalized) ?? 'Step';
  if (category === 'input') {
    return `Input — ${human}`;
  }
  if (category === 'output') {
    return `Output — ${human}`;
  }
  return human;
}

function classify(
  node: FlowDocumentNode,
  short: string | undefined,
  initialNodeIds: Set<string>,
): NodeCategory {
  // `baseType` is the authoritative classifier in real documents. Verified live
  // values: input, output, container (clean steps), superNode (join/union/
  // aggregate/pivot), transform (simple join/union). Everything that is not an
  // input or output is a transformation step.
  const base = node.baseType?.toLowerCase();
  if (base === 'input') {
    return 'input';
  }
  if (base === 'output') {
    return 'output';
  }
  if (base === 'container' || base === 'supernode' || base === 'transform') {
    return 'transform';
  }
  // Fallbacks for when baseType is missing/unknown (defensive — not seen live).
  if (node.id && initialNodeIds.has(node.id)) {
    return 'input';
  }
  if (short) {
    if (/^Load/.test(short)) {
      return 'input';
    }
    if (/^(Publish|WriteTo|Output|SaveTo)/.test(short)) {
      return 'output';
    }
  }
  return 'transform';
}

function summarizeConnection(
  id: string | undefined,
  conn: FlowDocumentConnection | undefined,
): FlowConnectionSummary {
  if (!conn) {
    return prune({ id });
  }
  const attrs = conn.connectionAttributes;
  const cls = str(attrs?.['class']);
  return prune({
    id: conn.id ?? id,
    type: cls ?? shortType(conn.connectionType),
    class: cls,
    server: str(attrs?.['server']),
    port: str(attrs?.['port']),
    database: str(attrs?.['dbname']) ?? str(attrs?.['database']),
    schema: str(attrs?.['schema']),
    warehouse: str(attrs?.['warehouse']),
    file: str(attrs?.['filename']) ?? str(attrs?.['file']),
    isPackaged: conn.isPackaged,
  });
}

function summarizeIdentity(flow: Flow | undefined): FlowIdentitySummary {
  if (!flow) {
    return {};
  }
  return prune({
    id: flow.id,
    name: flow.name,
    description: str(flow.description),
    project: flow.project?.name,
    owner: flow.owner?.fullName ?? flow.owner?.name,
    fileType: flow.fileType,
    updatedAt: flow.updatedAt,
    webpageUrl: flow.webpageUrl,
    tags: flow.tags?.tag?.map((t) => t.label).filter((l): l is string => !!l),
  });
}

export function summarizeFlowDocument({
  document,
  flow,
  includeFieldSchemas = false,
}: {
  document: FlowDocument;
  flow?: Flow;
  includeFieldSchemas?: boolean;
}): DescribeFlowResult {
  const nodeEntries = Object.entries(document.nodes ?? {});
  const initialNodeIds = new Set(document.initialNodes ?? []);

  // Merge the two connection maps (the document splits "connections" and
  // "dataConnections"); key by the connection's own id so node lookups resolve.
  const connMap = new Map<string, FlowDocumentConnection>();
  for (const [cid, conn] of Object.entries(document.connections ?? {})) {
    connMap.set(conn.id ?? cid, conn);
  }
  for (const [cid, conn] of Object.entries(document.dataConnections ?? {})) {
    connMap.set(conn.id ?? cid, conn);
  }

  // Human-readable lineage: resolve node ids to names where possible.
  const nameById = new Map<string, string>();
  for (const [nid, node] of nodeEntries) {
    nameById.set(node.id ?? nid, node.name ?? shortType(node.nodeType) ?? nid);
  }

  const inputs: FlowInputSummary[] = [];
  const outputs: FlowOutputSummary[] = [];
  const steps: FlowStepSummary[] = [];
  const lineage: FlowLineageEdge[] = [];
  const fields: Record<string, Array<{ name?: string; type?: string }>> = {};

  for (const [nid, node] of nodeEntries) {
    const id = node.id ?? nid;
    const short = shortType(node.nodeType);
    const category = classify(node, short, initialNodeIds);

    for (const next of node.nextNodes ?? []) {
      if (next.nextNodeId) {
        lineage.push({
          from: nameById.get(id) ?? id,
          to: nameById.get(next.nextNodeId) ?? next.nextNodeId,
        });
      }
    }

    if (includeFieldSchemas && node.fields && node.fields.length > 0) {
      fields[node.name ?? id] = node.fields.map((f) => prune({ name: f.name, type: f.type }));
    }

    if (category === 'input') {
      const conn = node.connectionId ? connMap.get(node.connectionId) : undefined;
      inputs.push(
        prune({
          nodeId: id,
          name: node.name,
          nodeType: short,
          role: roleLabel(short, 'input'),
          connection: node.connectionId ? summarizeConnection(node.connectionId, conn) : undefined,
        }),
      );
    } else if (category === 'output') {
      const target = pickStrings(node as unknown as Record<string, unknown>, [
        'outputFile',
        'filename',
        'datasourceName',
        'projectName',
        'tableName',
        'dbName',
        'schema',
        'outputType',
      ]);
      outputs.push(
        prune({
          nodeId: id,
          name: node.name,
          nodeType: short,
          role: roleLabel(short, 'output'),
          target,
        }),
      );
    } else {
      steps.push(
        prune({
          nodeId: id,
          name: node.name,
          nodeType: short,
          role: roleLabel(short, 'transform'),
        }),
      );
    }
  }

  const connections: FlowConnectionSummary[] = [];
  for (const [cid, conn] of connMap) {
    connections.push(summarizeConnection(cid, conn));
  }

  // Prefer the strongly-typed parameters from the Flow metadata (Query Flow);
  // fall back to the document's parameter map only when metadata is absent.
  const parameters: FlowParameterSummary[] = [];
  const flowParams = flow?.parameters?.parameter ?? [];
  if (flowParams.length > 0) {
    for (const p of flowParams) {
      parameters.push(prune({ name: p.name, type: p.type, value: p.value }));
    }
  } else {
    for (const raw of Object.values(document.parameters?.parameters ?? {})) {
      if (raw && typeof raw === 'object') {
        const rec = raw as Record<string, unknown>;
        parameters.push(
          prune({
            name: str(rec['name']),
            type: str(rec['type']) ?? str(rec['parameterType']),
            value: str(rec['value']) ?? str(rec['defaultValue']),
          }),
        );
      }
    }
  }

  const warnings: DescribeFlowWarning[] = [];
  if (nodeEntries.length === 0) {
    warnings.push({
      type: 'EMPTY_DOCUMENT',
      severity: 'WARNING',
      message:
        'The flow document contained no recognizable steps. It may be empty, or the experimental document format may have changed.',
      affectedField: 'steps',
    });
  }

  return {
    flow: summarizeIdentity(flow),
    stats: {
      nodeCount: nodeEntries.length,
      inputCount: inputs.length,
      outputCount: outputs.length,
      transformCount: steps.length,
      connectionCount: connections.length,
    },
    inputs,
    outputs,
    steps,
    lineage,
    connections,
    parameters,
    ...(includeFieldSchemas ? { fields } : {}),
    ...(warnings.length > 0 ? { mcp: { warnings } } : {}),
  };
}
