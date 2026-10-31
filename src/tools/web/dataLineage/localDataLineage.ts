import { DataLineageTraversal } from '../../../sdks/tableau/methods/dataLineage.js';
import {
  DataLineageResult,
  LineageEdge,
  LineageNode,
  LineageOptions,
} from '../../../sdks/tableau/types/dataLineage.js';
import { FlowDocument, FlowDocumentNode } from '../../../sdks/tableau/types/flowDocument.js';
import { FileSystem } from '../../../utils/fileSystem.js';
import { LocalFlowAccessError, readLocalFlowFile } from './localFlowFile.js';
import { analyzePrepFields } from './prepFieldLineage.js';
import policies from './prepNodePolicies.json';
import { extractPrepOperations } from './prepOperations.js';

/** Bound untrusted local metadata before producing repeated graph paths. */
function checkComplexity(document: FlowDocument): void {
  const stack: Array<{ value: unknown; depth: number }> = [{ value: document, depth: 0 }];
  let count = 0;
  while (stack.length) {
    const { value, depth } = stack.pop()!;
    if (++count > 100000 || depth > 40 || (typeof value === 'string' && value.length > 8000))
      throw new LocalFlowAccessError('UNAVAILABLE');
    if (Array.isArray(value))
      stack.push(...value.map((child) => ({ value: child, depth: depth + 1 })));
    else if (value && typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) {
        if (key.length > 1024) throw new LocalFlowAccessError('UNAVAILABLE');
        stack.push({ value: child, depth: depth + 1 });
      }
    }
  }
}

/** Local source identities are file fingerprints, never invented REST LUIDs.
 * No Metadata, document, database, script or model endpoint is contacted. */
export function executeLocalDataLineage(
  options: LineageOptions,
  config: { transport: string; localFlowRoots?: string[] },
  signal: AbortSignal,
  fs?: FileSystem,
): DataLineageResult {
  const traversal = new DataLineageTraversal(options, {
    graphql: async () => {
      throw new Error('Local analysis cannot query Tableau.');
    },
    isAllowed: async () => true,
    prepEnabled: true,
    signal,
  });
  const graph = traversal.result;
  graph.coverage.metadata = 'not-requested';
  graph.coverage.permissionMode = 'NOT_REQUESTED';
  graph.coverage.prep = 'unavailable';
  if (options.source.type !== 'local-flow') throw new Error('Expected a local-flow source.');
  signal.throwIfAborted();
  let file;
  try {
    file = readLocalFlowFile(options.source.path, config, fs);
    checkComplexity(file.document);
  } catch (error) {
    graph.resolution =
      error instanceof LocalFlowAccessError && error.code === 'NOT_ALLOWED'
        ? 'not-allowed'
        : 'unavailable';
    traversal.warn(
      'LOCAL_FLOW_UNAVAILABLE',
      'Local analysis requires stdio, an absolute TFL/TFLX path inside LOCAL_FLOW_ROOTS and a bounded, unchanged regular file. Unsupported/invalid metadata is unknown.',
    );
    return graph;
  }
  signal.throwIfAborted();
  const documentId = `local:${file.source.sha256}`;
  const root: LineageNode = { id: documentId, documentId, kind: 'flow', name: file.name };
  const analysis = analyzePrepFields(file.document, documentId, 10000);
  const fields = analysis.nodes.map(
    ({ flowLuid: _discard, ...node }): LineageNode => ({ ...node, documentId }),
  );
  const edges: LineageEdge[] = analysis.edges.map((edge) => ({
    ...edge,
    provenance: 'local-flow-file',
  }));
  const steps = new Map<string, { key: string; raw: FlowDocumentNode; node: LineageNode }>();
  const duplicates = new Set<string>();
  for (const [key, raw] of Object.entries(file.document.nodes ?? {})) {
    const id = raw.id ?? key;
    if (id.length > 1024) {
      traversal.warn('LOCAL_STEP_ID_UNSUPPORTED', 'An overlong local step identity was omitted.');
      continue;
    }
    if (steps.has(id)) duplicates.add(id);
    steps.set(id, {
      key,
      raw,
      node: {
        id: `local-step:${JSON.stringify([documentId, id])}`,
        documentId,
        kind: 'prep-step',
        stepId: id,
        name: raw.name,
        operation: raw.nodeType?.split('.').pop(),
      },
    });
  }
  for (const id of duplicates) steps.delete(id);
  if (duplicates.size)
    traversal.warn('PREP_DUPLICATE_STEP', 'Ambiguous local step IDs were omitted.');
  const selection = options.source.at;
  const entry = selection ? steps.get(selection.stepId) : undefined;
  const ports = entry ? analysis.outputs.get(entry.key) : undefined;
  const state =
    selection?.type === 'field'
      ? selection.namespace
        ? ports?.get(selection.namespace)
        : ports?.size === 1
          ? [...ports.values()][0]
          : undefined
      : undefined;
  const version = selection?.type === 'field' ? state?.fields.get(selection.name) : undefined;
  const origin = version ? fields.find((node) => node.id === version) : undefined;
  const selected: LineageNode | undefined = !selection
    ? root
    : selection.type === 'step'
      ? entry?.node
      : origin
        ? {
            ...origin,
            id: `local-selection:${JSON.stringify([documentId, selection.stepId, selection.namespace, selection.name])}`,
            stepId: selection.stepId,
            operation: 'selected-step-field',
          }
        : undefined;
  if (!selected) {
    graph.resolution = analysis.truncated ? 'unavailable' : 'not-found';
    traversal.warn(
      'LOCAL_ORIGIN_UNRESOLVED',
      'No unique local step/output field could be resolved. Specify the exact step, name and namespace; incomplete schemas remain unknown.',
    );
    return graph;
  }
  const edge = (
    from: string,
    to: string,
    relationship: string,
    evidence: LineageEdge['evidence'],
    propagates = true,
  ): void => {
    edges.push({
      id: JSON.stringify([from, to, relationship]),
      from,
      to,
      relationship,
      evidence,
      provenance: 'local-flow-file',
      propagates,
    });
  };
  for (const { raw, node } of steps.values()) {
    for (const next of raw.nextNodes ?? []) {
      const target = next.nextNodeId ? steps.get(next.nextNodeId) : undefined;
      if (target) edge(node.id, target.node.id, 'nextNodes', 'direct');
      else traversal.warn('PREP_DANGLING_STEP', 'A local topology link could not be resolved.');
    }
    if (!selection) edge(root.id, node.id, 'contains-local-step', 'unknown', false);
  }
  if (!selection)
    for (const node of fields)
      edge(root.id, node.id, 'contains-local-field-version', 'unknown', false);
  const reachableSteps = new Set<string>();
  if (selection && entry) {
    const queue = [selection.stepId];
    while (queue.length) {
      const id = queue.shift()!;
      if (reachableSteps.has(id)) continue;
      reachableSteps.add(id);
      for (const next of steps.get(id)?.raw.nextNodes ?? [])
        if (next.nextNodeId) queue.push(next.nextNodeId);
    }
  }
  if (selection?.type === 'field' && origin) {
    edge(origin.id, selected.id, 'selected-step-output-field', 'direct');
    // Do not let a passthrough field at one step expand into earlier sibling
    // branches that share the same creation version.
    for (const dependency of analysis.edges) {
      const target = fields.find((node) => node.id === dependency.to);
      if (dependency.from === origin.id && target?.stepId && reachableSteps.has(target.stepId))
        edge(selected.id, target.id, dependency.relationship, dependency.evidence);
    }
  }
  for (const { key, raw, node } of steps.values()) {
    if (policies[raw.nodeType as keyof typeof policies] !== 'output') continue;
    for (const outputState of analysis.outputs.get(key)?.values() ?? [])
      for (const id of outputState.fields.values()) {
        edge(id, node.id, 'output-step-receives-field', 'direct', false);
        if (
          selection?.type === 'field' &&
          id === origin?.id &&
          node.stepId &&
          reachableSteps.has(node.stepId)
        )
          edge(selected.id, node.id, 'output-step-receives-field', 'direct', false);
      }
  }
  const allNodes = [selected, root, ...steps.values()]
    .map((value) => ('node' in value ? value.node : value))
    .concat(fields);
  const unique = new Map(allNodes.map((node) => [node.id, node]));
  unique.set(selected.id, selected);
  const relevant = new Set<string>();
  const walk = (upstream: boolean): void => {
    const adjacency = new Map<string, string[]>();
    for (const link of edges) {
      const from = upstream ? link.to : link.from;
      const to = upstream ? link.from : link.to;
      adjacency.set(from, [...(adjacency.get(from) ?? []), to]);
    }
    const queue = [selected.id];
    const seen = new Set<string>();
    while (queue.length) {
      const id = queue.shift()!;
      if (seen.has(id)) continue;
      seen.add(id);
      relevant.add(id);
      queue.push(...(adjacency.get(id) ?? []));
    }
  };
  if (options.direction !== 'upstream') walk(false);
  if (options.direction !== 'downstream') walk(true);
  const ordered = [
    selected,
    ...[...unique.values()].filter(
      (node) => node.id !== selected.id && (!selection || relevant.has(node.id)),
    ),
  ];
  graph.nodes = ordered.slice(0, options.maxNodes);
  if (ordered.length > options.maxNodes || analysis.truncated)
    traversal.truncate('LOCAL_NODE_LIMIT');
  const included = new Set(graph.nodes.map((node) => node.id));
  const seenEdges = new Set<string>();
  for (const link of edges)
    if (included.has(link.from) && included.has(link.to) && !seenEdges.has(link.id)) {
      seenEdges.add(link.id);
      if (graph.edges.length >= options.maxEdges) {
        traversal.truncate('EDGE_LIMIT');
        break;
      }
      graph.edges.push(link);
    }
  const details = extractPrepOperations(
    file.document.nodes ?? {},
    Math.min(500, options.maxNodes * 5),
  );
  if (details.truncated) traversal.truncate('PREP_DETAIL_LIMIT');
  graph.prepDetails = [
    {
      documentId,
      source: { ...file.source, name: file.name },
      operations: details.operations,
      fieldAnalysis: {
        versionCount: analysis.nodes.length,
        issues: analysis.issues,
        truncated: analysis.truncated,
      },
    },
  ];
  graph.resolution = 'resolved';
  graph.sourceId = selected.id;
  graph.coverage.prep = 'static-fields-with-gaps';
  traversal.warn(
    'LOCAL_PUBLICATION_UNVERIFIED',
    'Local files establish only saved internal dependencies. No published flow, data source, worksheet or dashboard is joined by filename, field name or unverified embedded ID.',
  );
  if (analysis.issues.length)
    traversal.warn(
      'PREP_STATIC_GAPS',
      'Some local field mappings are unresolved; see prepDetails.fieldAnalysis.issues.',
    );
  graph.limitations.push(
    'Local flow analysis performs no Tableau requests or execution. Published downstream impact requires a separately verified published origin.',
  );
  return graph;
}
