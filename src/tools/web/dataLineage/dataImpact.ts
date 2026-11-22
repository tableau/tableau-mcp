import {
  DataImpact,
  DataLineageResult,
  LineageEdge,
} from '../../../sdks/tableau/types/dataLineage.js';

/** Strongest known path per target, then shortest. Rollup hops never become
 * direct merely because the graph represents them with a single edge. */
export function analyzeLineageImpact(graph: DataLineageResult): DataImpact[] {
  if (!graph.sourceId) return [];
  const paths = new Map<string, { severity: number; nodeIds: string[]; edgeIds: string[] }>();
  const outgoing = new Map<string, LineageEdge[]>();
  for (const edge of graph.edges)
    outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge]);
  const queue = [
    { nodeId: graph.sourceId, severity: 0, nodeIds: [graph.sourceId], edgeIds: [] as string[] },
  ];
  // Terminal container membership can be a result but cannot be a bridge to
  // another asset. Keep expansion state separate from best result paths.
  const expansions = new Map<string, { severity: number; length: number }>();
  while (queue.length) {
    const path = queue.shift()!;
    const previous = expansions.get(path.nodeId);
    if (
      previous &&
      (previous.severity < path.severity ||
        (previous.severity === path.severity && previous.length <= path.edgeIds.length))
    )
      continue;
    expansions.set(path.nodeId, { severity: path.severity, length: path.edgeIds.length });
    for (const edge of outgoing.get(path.nodeId) ?? []) {
      if (path.nodeIds.includes(edge.to)) continue;
      const severity = Math.max(
        path.severity,
        edge.evidence === 'unknown' ? 2 : edge.evidence === 'possible' ? 1 : 0,
      );
      const candidate = {
        severity,
        nodeIds: [...path.nodeIds, edge.to],
        edgeIds: [...path.edgeIds, edge.id],
      };
      const best = paths.get(edge.to);
      if (
        !best ||
        severity < best.severity ||
        (severity === best.severity && candidate.edgeIds.length < best.edgeIds.length)
      )
        paths.set(edge.to, candidate);
      if (edge.propagates) queue.push({ nodeId: edge.to, ...candidate });
    }
  }
  return [...paths].map(([nodeId, path]) => ({
    nodeId,
    classification:
      path.severity === 2
        ? 'unknown'
        : path.severity === 1
          ? 'possible'
          : path.edgeIds.length === 1
            ? 'direct'
            : 'indirect',
    path: { nodeIds: path.nodeIds, edgeIds: path.edgeIds },
  }));
}
