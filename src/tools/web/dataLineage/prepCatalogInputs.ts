import { LineageNode, PrepSchemaObservation } from '../../../sdks/tableau/types/dataLineage.js';
import { PrepScriptContext } from '../../../sdks/tableau/types/prepScript.js';
import { prepCatalogBindings } from './prepCatalogBindings.js';
import { analyzePrepFields, PrepCatalogInput, PrepFieldAnalysis } from './prepFieldLineage.js';
import policies from './prepNodePolicies.json';

const uuid = '[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}';
const qualified = new RegExp(`^(${uuid})-(.+)$`, 'i');
const nested = new RegExp(`^${uuid}-`, 'i');

/** Saved input fields can be a stale cache. Recover an individually indexed
 * input only from its exact native node identity in the permitted catalog.
 * Analyze first so input-local calculations/renames are never mistaken for
 * new raw inputs. A partial catalog does not replace a complete observation. */
export function analyzePrepCatalogFields(
  flow: unknown,
  flowLuid: string,
  maxVersions: number,
  observations: PrepSchemaObservation[],
  catalog: LineageNode[],
  scriptContext?: PrepScriptContext,
): PrepFieldAnalysis {
  const baseline = analyzePrepFields(flow, flowLuid, maxVersions, observations, [], scriptContext);
  if (baseline.truncated) return baseline;
  const inputs = new Set(
    baseline.schemaRequirements?.nodes
      .filter((node) => (policies as Record<string, string>)[node.nodeType] === 'input')
      .map((node) => node.nodeId),
  );
  const additions = new Map<string, PrepCatalogInput>();
  for (const binding of prepCatalogBindings(catalog, flowLuid, baseline)) {
    const field = binding.catalog;
    if (
      binding.version ||
      !['native-field-id-not-found', 'native-input-field-absent-from-saved-schema'].includes(
        binding.reason ?? '',
      ) ||
      field.kind !== 'flow-input-field' ||
      !['FlowColumnInputField', 'FlowFieldInputField'].includes(field.metadataType ?? '') ||
      !field.fieldId ||
      field.fieldId.length > 2048
    )
      continue;
    const match = qualified.exec(field.fieldId);
    if (!match || !inputs.has(match[1])) continue;
    const nodeId = match[1];
    const name = match[2].startsWith(`${nodeId}-`) ? match[2].slice(nodeId.length + 1) : match[2];
    if (
      !name.trim() ||
      name.length > 1024 ||
      [...name].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) ||
      /<Parameters\.|^\{/.test(name) ||
      nested.test(name) ||
      observations.some(
        (observation) =>
          observation.nodeId === nodeId &&
          observation.documentSha256 === baseline.schemaRequirements?.documentSha256,
      )
    )
      continue;
    const states = [...(baseline.outputs.get(nodeId)?.values() ?? [])];
    if (
      states.length !== 1 ||
      !states[0].complete ||
      states[0].fields.has(name) ||
      baseline.nodes.some((version) => version.stepId === nodeId && version.name === name)
    )
      continue;
    additions.set(JSON.stringify([nodeId, name]), { nodeId, name, fieldId: field.fieldId });
    if (additions.size >= maxVersions) break;
  }
  return additions.size
    ? analyzePrepFields(
        flow,
        flowLuid,
        maxVersions,
        observations,
        [...additions.values()],
        scriptContext,
      )
    : baseline;
}
