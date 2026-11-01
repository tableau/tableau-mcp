import { DataLineageTraversal } from '../../../sdks/tableau/methods/dataLineage.js';
import { LineageNode, LineageSource } from '../../../sdks/tableau/types/dataLineage.js';
import { prepCatalogBindings } from './prepCatalogBindings.js';
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
    const walk = (upstream: boolean): void => {
      const adjacency = new Map<string, string[]>();
      for (const edge of analysis.edges) {
        const from = upstream ? edge.to : edge.from;
        const to = upstream ? edge.from : edge.to;
        adjacency.set(from, [...(adjacency.get(from) ?? []), to]);
      }
      const queue = [selectedId];
      const seen = new Set<string>();
      while (queue.length) {
        const id = queue.shift()!;
        if (seen.has(id)) continue;
        seen.add(id);
        relevant.add(id);
        if (relevant.size > traversal.options.maxNodes) {
          traversal.truncate('NODE_LIMIT');
          break;
        }
        queue.push(...(adjacency.get(id) ?? []));
      }
    };
    if (traversal.options.direction !== 'upstream') walk(false);
    if (traversal.options.direction !== 'downstream') walk(true);
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
  ): boolean => {
    if (!included.has(from) || !included.has(to)) return false;
    const id = JSON.stringify([from, to, relationship]);
    if (graph.edges.some((edge) => edge.id === id)) return true;
    if (graph.edges.length >= traversal.options.maxEdges) {
      traversal.truncate('EDGE_LIMIT');
      return false;
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
    return true;
  };
  for (const edge of analysis.edges)
    add(edge.from, edge.to, edge.relationship, edge.evidence, true);
  for (const node of candidates)
    if (!fieldSource) add(flow.id, node.id, 'contains-static-field-version', 'unknown', false);
  const bindings = prepCatalogBindings(graph.nodes, flow.luid ?? '', analysis);
  let confirmed = 0;
  const unresolvedReasons: Record<string, number> = {};
  const confirmedOutputs = new Set<string>();
  for (const binding of bindings) {
    if (!binding.version) {
      const reason = binding.reason ?? 'unresolved';
      unresolvedReasons[reason] = (unresolvedReasons[reason] ?? 0) + 1;
      continue;
    }
    const input = binding.catalog.kind === 'flow-input-field';
    if (
      add(
        input ? binding.catalog.id : binding.version,
        input ? binding.version : binding.catalog.id,
        'native-flow-field-id',
        'direct',
        true,
      )
    ) {
      confirmed++;
      if (!input) confirmedOutputs.add(JSON.stringify([binding.catalog.stepId, binding.version]));
    } else unresolvedReasons['graph-limit'] = (unresolvedReasons['graph-limit'] ?? 0) + 1;
  }
  const details = graph.prepDetails?.find((detail) => detail.flowLuid === flow.luid);
  if (details?.fieldAnalysis)
    details.fieldAnalysis.catalogBindings = {
      confirmed,
      unresolved: bindings.length - confirmed,
      ...(Object.keys(unresolvedReasons).length ? { unresolvedReasons } : {}),
    };
  let unverifiedOutput = false;
  for (const output of graph.nodes.filter(
    (node) => node.kind === 'flow-output-step' && node.flowLuid === flow.luid && node.stepId,
  )) {
    for (const state of analysis.outputs.get(output.stepId!)?.values() ?? [])
      for (const id of state.fields.values()) {
        add(id, output.id, 'prep-field-in-output-step', 'direct', false);
        if (!confirmedOutputs.has(JSON.stringify([output.stepId, id]))) {
          unverifiedOutput = true;
          add(id, output.id, 'unverified-catalog-output-field-binding', 'possible', true);
        }
      }
  }
  if (bindings.length > confirmed || unverifiedOutput)
    traversal.warn(
      'PREP_CATALOG_BINDING_UNVERIFIED',
      'Some catalog/document field identities could not be matched by exact native fieldId and output step. Confirmed native-ID handoffs remain direct; unresolved identities are never joined by caption.',
      flow.id,
    );
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
      'Saved field analysis found broken references or unresolved mappings. See prepDetails.fieldAnalysis.issues: broken means a missing name in a complete saved/observed schema; unresolved means the schema or mapping is unavailable. Unresolved mappings never establish a confirmed dependency.',
      flow.id,
    );
  if (analysis.truncated) traversal.truncate('PREP_FIELD_LIMIT');
}
