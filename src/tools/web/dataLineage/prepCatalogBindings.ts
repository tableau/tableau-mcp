import { LineageNode } from '../../../sdks/tableau/types/dataLineage.js';
import { PrepFieldAnalysis } from './prepFieldLineage.js';
import policies from './prepNodePolicies.json';

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
      // Observed Cloud IDs add a node scope around a native field identifier.
      // A repeated origin scope or the exact output-step scope is structural
      // evidence; an arbitrary UUID prefix is not a removable decoration.
      const envelope = node.fieldId.match(
        /^([a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12})-([a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}-.+)$/i,
      );
      const repeatedScope = envelope?.[2].startsWith(`${envelope[1]}-`) ?? false;
      const outputScope = node.kind === 'flow-output-field' && envelope?.[1] === node.stepId;
      const nativeId = envelope && (repeatedScope || outputScope) ? envelope[2] : undefined;
      const scoped = nativeId
        ? (analysis.nativeFieldIds.get(nativeId) ?? new Set<string>())
        : new Set<string>();
      let candidates: string[];
      let absentFromInputSchema = false;
      if (node.kind === 'flow-input-field') {
        candidates = [...new Set([...identified, ...scoped])].filter((id) =>
          ['input', 'input-union', 'generated-source-row-number'].includes(
            versions.get(id)?.operation ?? '',
          ),
        );
        const qualified = candidates.filter((id) => {
          const version = versions.get(id)!;
          return (nativeId ?? node.fieldId) === `${version.stepId}-${version.name}`;
        });
        if (qualified.length) candidates = qualified;
        if (
          !candidates.length &&
          envelope &&
          repeatedScope &&
          analysis.schemaRequirements?.nodes.some(
            (input) =>
              input.nodeId === envelope[1] &&
              (policies as Record<string, string>)[input.nodeType] === 'input',
          )
        ) {
          // Input-local actions may rename or create a field before its exposed
          // schema. Resolve the full native identity at that exact input output.
          const scopedInputs = [...(analysis.outputs.get(envelope[1])?.values() ?? [])].flatMap(
            (state) =>
              [...state.fields.values()].filter(
                (id) => nativeId === `${envelope[1]}-${versions.get(id)?.name}`,
              ),
          );
          candidates = [...new Set([...candidates, ...scopedInputs])];
          const states = [...(analysis.outputs.get(envelope[1])?.values() ?? [])];
          const name = nativeId?.slice(envelope[1].length + 1);
          absentFromInputSchema =
            !candidates.length &&
            !!name &&
            states.length > 0 &&
            states.every((state) => state.complete && !state.fields.has(name));
        }
      } else {
        if (!node.stepId) return { catalog: node, reason: 'missing-output-step-id' };
        const outputs = analysis.outputs.get(node.stepId);
        candidates = [
          ...new Set(
            [...(outputs?.values() ?? [])].flatMap((state) =>
              [...state.fields.values()].filter(
                (id) =>
                  identified.has(id) ||
                  scoped.has(id) ||
                  (outputScope && nativeId === `${node.stepId}-${versions.get(id)?.name}`),
              ),
            ),
          ),
        ];
      }
      return candidates.length === 1
        ? { catalog: node, version: candidates[0] }
        : {
            catalog: node,
            reason: candidates.length
              ? 'ambiguous-native-field-id'
              : absentFromInputSchema
                ? 'native-input-field-absent-from-saved-schema'
                : 'native-field-id-not-found',
          };
    });
}
