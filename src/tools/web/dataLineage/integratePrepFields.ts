import { DataLineageTraversal } from '../../../sdks/tableau/methods/dataLineage.js';
import { LineageNode, LineageSource } from '../../../sdks/tableau/types/dataLineage.js';
import { PrepFieldAnalysis } from './prepFieldLineage.js';

/** Import a bounded, source-relevant slice of static field versions. A known
 * output-step membership is kept separate from its unverified catalog-field
 * mapping, so unrelated output fields can never become confirmed impacts. */
export function integratePrepFields(
  traversal: DataLineageTraversal,
  flow: LineageNode,
  analysis: PrepFieldAnalysis,
  source: LineageSource,
): void {
  const graph = traversal.result;
  const fieldSource =
    source.type === 'prep-field' && source.flowLuid === flow.luid ? source : undefined;
  const sourcePorts = fieldSource ? analysis.outputs.get(fieldSource.stepId) : undefined;
  const sourceState = fieldSource?.namespace
    ? sourcePorts?.get(fieldSource.namespace)
    : sourcePorts?.size === 1
      ? [...sourcePorts.values()][0]
      : undefined;
  const selectedId = fieldSource ? sourceState?.fields.get(fieldSource.name) : undefined;
  if (fieldSource) {
    // Replace the conservative schema-only placeholder with an actual version.
    const placeholder = graph.sourceId;
    if (placeholder?.startsWith('prep-field:')) {
      graph.nodes = graph.nodes.filter((node) => node.id !== placeholder);
      graph.edges = graph.edges.filter(
        (edge) => edge.from !== placeholder && edge.to !== placeholder,
      );
    }
    graph.sourceId = undefined;
    if (!selectedId) {
      graph.resolution = 'not-found';
      traversal.warn(
        'PREP_FIELD_UNRESOLVED',
        'No unique output field version was resolved at this step/namespace. Dynamic schemas, unsupported operations or an ambiguous Group port prevent a determination.',
      );
      return;
    }
  }
  const relevant = new Set<string>();
  if (selectedId) {
    const adjacency = new Map<string, string[]>();
    for (const edge of analysis.edges) {
      if (traversal.options.direction !== 'upstream')
        adjacency.set(edge.from, [...(adjacency.get(edge.from) ?? []), edge.to]);
      if (traversal.options.direction !== 'downstream')
        adjacency.set(edge.to, [...(adjacency.get(edge.to) ?? []), edge.from]);
    }
    const queue = [selectedId];
    while (queue.length) {
      const id = queue.shift()!;
      if (relevant.has(id)) continue;
      relevant.add(id);
      if (relevant.size > traversal.options.maxNodes) {
        traversal.truncate('NODE_LIMIT');
        break;
      }
      queue.push(...(adjacency.get(id) ?? []));
    }
  } else analysis.nodes.forEach((node) => relevant.add(node.id));
  const candidates = analysis.nodes
    .filter((node) => relevant.has(node.id))
    .sort((a, b) => Number(b.id === selectedId) - Number(a.id === selectedId));
  for (const node of candidates) {
    if (graph.nodes.some((existing) => existing.id === node.id)) continue;
    if (graph.nodes.length >= traversal.options.maxNodes) {
      traversal.truncate('NODE_LIMIT');
      break;
    }
    graph.nodes.push(node);
  }
  const included = new Set(graph.nodes.map((node) => node.id));
  const add = (
    from: string,
    to: string,
    relationship: string,
    evidence: 'direct' | 'possible' | 'unknown',
    propagates: boolean,
  ): void => {
    if (!included.has(from) || !included.has(to)) return;
    const id = JSON.stringify([from, to, relationship]);
    if (graph.edges.some((edge) => edge.id === id)) return;
    if (graph.edges.length >= traversal.options.maxEdges) {
      traversal.truncate('EDGE_LIMIT');
      return;
    }
    graph.edges.push({
      id,
      from,
      to,
      relationship,
      evidence,
      provenance: 'flow-document',
      propagates,
    });
  };
  for (const edge of analysis.edges)
    add(edge.from, edge.to, edge.relationship, edge.evidence, true);
  for (const node of candidates)
    if (!fieldSource) add(flow.id, node.id, 'contains-static-field-version', 'unknown', false);
  for (const output of graph.nodes.filter(
    (node) => node.kind === 'flow-output-step' && node.flowLuid === flow.luid && node.stepId,
  )) {
    for (const state of analysis.outputs.get(output.stepId!)?.values() ?? [])
      for (const id of state.fields.values()) {
        add(id, output.id, 'prep-field-in-output-step', 'direct', false);
        add(id, output.id, 'unverified-catalog-output-field-binding', 'possible', true);
      }
  }
  if (fieldSource) {
    if (included.has(selectedId!)) {
      graph.sourceId = selectedId;
      graph.resolution = 'resolved';
    } else {
      graph.resolution = 'unavailable';
      traversal.warn(
        'PREP_SOURCE_LIMITED',
        'The selected field version could not be included within the configured graph limits.',
      );
    }
  }
  if (analysis.issues.length)
    traversal.warn(
      'PREP_STATIC_GAPS',
      'Some static field mappings are unresolved. See prepDetails.fieldAnalysis.issues; unresolved mappings never establish a confirmed dependency.',
      flow.id,
    );
  if (analysis.truncated) traversal.truncate('PREP_FIELD_LIMIT');
}
