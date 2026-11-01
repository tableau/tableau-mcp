import { LineageNode } from '../../../sdks/tableau/types/dataLineage.js';
import { PrepFieldAnalysis } from './prepFieldLineage.js';

/** fieldId is the published API's identifier internal to the owning Flow.
 * Exact native identifiers/qualified node identities establish a handoff;
 * captions, substrings, field order and types alone never establish identity.
 * Output candidates must also occur at the API's exact output step. */
export function prepCatalogBindings(
  catalog: LineageNode[],
  flowLuid: string,
  analysis: PrepFieldAnalysis,
): Array<{ catalog: LineageNode; version?: string; reason?: string }> {
  const versions = new Map(analysis.nodes.map((node) => [node.id, node]));
  return catalog
    .filter(
      (node) =>
        (node.flowLuid === flowLuid || node.flowLuids?.includes(flowLuid)) &&
        (node.kind === 'flow-input-field' || node.kind === 'flow-output-field'),
    )
    .map((node) => {
      if (!node.fieldId) return { catalog: node, reason: 'missing-native-field-id' };
      const identified = analysis.nativeFieldIds.get(node.fieldId) ?? new Set<string>();
      let candidates: string[];
      if (node.kind === 'flow-input-field') {
        candidates = [...identified].filter((id) =>
          ['input', 'input-union', 'generated-source-row-number'].includes(
            versions.get(id)?.operation ?? '',
          ),
        );
        const qualified = candidates.filter((id) => {
          const version = versions.get(id)!;
          return node.fieldId === `${version.stepId}-${version.name}`;
        });
        if (qualified.length) candidates = qualified;
      } else {
        if (!node.stepId) return { catalog: node, reason: 'missing-output-step-id' };
        const outputs = analysis.outputs.get(node.stepId);
        candidates = [
          ...new Set(
            [...(outputs?.values() ?? [])].flatMap((state) =>
              [...state.fields.values()].filter((id) => identified.has(id)),
            ),
          ),
        ];
      }
      return candidates.length === 1
        ? { catalog: node, version: candidates[0] }
        : {
            catalog: node,
            reason: candidates.length ? 'ambiguous-native-field-id' : 'native-field-id-not-found',
          };
    });
}
