import { DataLineageTraversal } from '../../../sdks/tableau/methods/dataLineage.js';
import { LineageNode, LineageSource } from '../../../sdks/tableau/types/dataLineage.js';
import { FlowDocument } from '../../../sdks/tableau/types/flowDocument.js';
import { integratePrepFields } from './integratePrepFields.js';
import { analyzePrepFields } from './prepFieldLineage.js';
import { extractPrepOperations } from './prepOperations.js';

/** Combine top-level step topology with allowlisted operation details. Local
 * expression names never become catalog-column identities by name matching. */
export function addPrepTopology(
  traversal: DataLineageTraversal,
  flow: LineageNode,
  document: FlowDocument,
  source: LineageSource,
): void {
  const graph = traversal.result;
  // Experimental API JSON must expose the supported nodes graph.
  // Do not guess package wrappers or silently assume native-format compatibility.
  if (!document.nodes || typeof document.nodes !== 'object' || Array.isArray(document.nodes)) {
    if (!graph.prepDetails?.length) graph.coverage.prep = 'unavailable';
    traversal.warn(
      'PREP_DOCUMENT_FORMAT_UNSUPPORTED',
      'The API JSON did not contain the supported native nodes graph. No package wrapper or TFL-format compatibility is guessed.',
      flow.id,
    );
    if (
      (source.type === 'prep-step' || source.type === 'prep-field') &&
      source.flowLuid === flow.luid
    ) {
      graph.sourceId = undefined;
      graph.resolution = 'unavailable';
    }
    return;
  }
  const internalSource =
    (source.type === 'prep-step' || source.type === 'prep-field') && source.flowLuid === flow.luid
      ? source
      : undefined;
  const steps = new Map<string, LineageNode>();
  const duplicate = new Set<string>();
  const entries = Object.entries(document.nodes ?? {});
  const details = extractPrepOperations(
    document.nodes ?? {},
    Math.max(1, traversal.options.maxNodes - graph.nodes.length),
  );
  const analysis = analyzePrepFields(
    document,
    flow.luid ?? '',
    Math.min(10000, traversal.options.maxNodes * 20),
  );
  if (flow.luid)
    (graph.prepDetails ??= []).push({
      flowLuid: flow.luid,
      operations: details.operations,
      fieldAnalysis: {
        versionCount: analysis.nodes.length,
        issues: analysis.issues,
        truncated: analysis.truncated,
      },
    });
  if (details.truncated) traversal.truncate('PREP_DETAIL_LIMIT');
  for (const [key, raw] of entries) {
    const stepId = raw.id ?? key;
    if (steps.has(stepId)) duplicate.add(stepId);
    steps.set(stepId, {
      id: `prep:${JSON.stringify([flow.luid, stepId])}`,
      kind: 'prep-step',
      stepId,
      name: raw.name,
      operation: raw.nodeType?.split('.').pop(),
    });
  }
  for (const id of duplicate) steps.delete(id);
  if (duplicate.size)
    traversal.warn(
      'PREP_DUPLICATE_STEP',
      'Duplicate document step IDs were omitted instead of joining ambiguous nodes.',
      flow.id,
    );
  const addNode = (node: LineageNode): boolean => {
    if (graph.nodes.some((n) => n.id === node.id)) return true;
    if (graph.nodes.length >= traversal.options.maxNodes) {
      traversal.truncate('NODE_LIMIT');
      return false;
    }
    graph.nodes.push(node);
    return true;
  };
  const addEdge = (
    from: string,
    to: string,
    relationship: string,
    evidence: 'direct' | 'unknown',
    propagates = true,
  ): void => {
    if (!graph.nodes.some((n) => n.id === from) || !graph.nodes.some((n) => n.id === to)) return;
    const id = JSON.stringify([from, to, relationship]);
    if (graph.edges.some((e) => e.id === id)) return;
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
  for (const step of steps.values()) addNode(step);
  let selected: LineageNode | undefined;
  for (const [key, raw] of entries) {
    const step = steps.get(raw.id ?? key);
    if (!step) continue;
    // Same-flow membership does not prove a column reference. Keep it terminal
    // and unknown; the separate nextNodes graph describes step topology only.
    if (!internalSource)
      addEdge(flow.id, step.id, 'contains-step-with-unknown-column-dependencies', 'unknown', false);
    for (const next of raw.nextNodes ?? []) {
      if (next.namespace || next.nextNamespace) {
        traversal.warn(
          'PREP_NAMESPACE_UNSUPPORTED',
          'Namespaced document links require additional schema support and were not joined.',
          flow.id,
        );
        continue;
      }
      const target = next.nextNodeId ? steps.get(next.nextNodeId) : undefined;
      if (target) addEdge(step.id, target.id, 'nextNodes', 'direct');
      else
        traversal.warn(
          'PREP_DANGLING_STEP',
          'A document connection points to a missing or ambiguous step.',
          flow.id,
        );
    }
    // The API's stepId is an explicit document-step identity. Names and field
    // captions are never used to bridge the two APIs.
    for (const output of graph.nodes.filter(
      (n) => n.kind === 'flow-output-step' && n.flowLuid === flow.luid && n.stepId === step.stepId,
    )) {
      addEdge(step.id, output.id, 'metadata-output-stepId', 'direct');
    }
    if (!internalSource || internalSource.stepId !== step.stepId) continue;
    if (internalSource.type === 'prep-step') selected = step;
    else {
      const declared = (Array.isArray(raw.fields) ? raw.fields : []).filter(
        (field) => field.name === internalSource.name,
      );
      const created = details.operations.filter(
        (op) => op.parentStepId === step.stepId && op.outputs.includes(internalSource.name),
      );
      const matches = declared.length
        ? declared
        : created.length === 1
          ? [{ name: internalSource.name }]
          : [];
      if (matches.length === 1) {
        const field = matches[0];
        selected = {
          id: `prep-field:${JSON.stringify([flow.luid, step.stepId, field.name])}`,
          kind: 'prep-field',
          name: field.name,
          dataType: field.type,
          stepId: step.stepId,
        };
        if (addNode(selected))
          addEdge(selected.id, step.id, 'step-field-dependency-unverified', 'unknown');
      }
    }
  }
  graph.coverage.prep = 'static-fields-with-gaps';
  traversal.warn(
    'PREP_CATALOG_BINDING_UNVERIFIED',
    'Supported static field versions follow saved operation order and namespaces. Catalog field-ID bindings remain unverified; dynamic or unsupported mappings are explicit gaps. Equal names across API namespaces are never joined.',
    flow.id,
  );
  if (!entries.length)
    traversal.warn(
      'PREP_EMPTY_DOCUMENT',
      'No supported top-level document steps were returned.',
      flow.id,
    );
  if (internalSource) {
    graph.sourceId = selected?.id;
    graph.resolution =
      selected && graph.nodes.some((n) => n.id === selected.id) ? 'resolved' : 'not-found';
    if (!selected)
      traversal.warn(
        'PREP_SOURCE_UNRESOLVED',
        'The requested step or unique field schema was not found; its dependencies are unknown.',
      );
    if (!graph.edges.some((e) => e.relationship === 'metadata-output-stepId'))
      traversal.warn(
        'PREP_OUTPUT_LINK_MISSING',
        'No exact document stepId to Metadata output-step link was available. Cross-content impact remains unknown.',
      );
  }
  integratePrepFields(traversal, flow, analysis, source);
}
