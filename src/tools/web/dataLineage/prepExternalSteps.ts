import { PrepExternalStep, PrepScriptAnalysis } from '../../../sdks/tableau/types/prepScript.js';

const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length <= 1024 ? value : undefined;

/** Preserve useful source settings while omitting path, connection/model values,
 * credentials and source text under the existing MCP projection boundary. */
export function describePrepExternalStep(
  node: Record<string, unknown>,
  path: string,
  owner: string,
  before: Array<{ name: string; type?: string }>,
  after: Array<{ name: string; type?: string }>,
  evidence?: PrepScriptAnalysis,
  observed = false,
): PrepExternalStep {
  const setup = object(node.setupParameters),
    execution = object(node.executionParameters),
    prediction = object(node.predictionSettings);
  const script = String(node.nodeType).endsWith('.ExtensibilityNode');
  const functionName = text(execution.scriptFunctionName);
  const fn =
    evidence && functionName && Object.hasOwn(evidence.functions, functionName)
      ? evidence.functions[functionName]
      : undefined;
  const used = script
    ? fn?.returnsInput
      ? before.map((field) => field.name)
      : (fn?.inputFields ?? [])
    : Object.keys(object(prediction.fieldMappings));
  const result: PrepExternalStep = {
    nodeId: text(node.id),
    stepId: owner,
    documentPath: path,
    family: script ? 'script' : 'prediction',
    settings: script
      ? {
          language:
            node.externalServiceType === 'pythonSupport'
              ? 'python'
              : node.externalServiceType === 'rSupport'
                ? 'r'
                : 'unknown',
          ...(functionName ? { function: functionName } : {}),
          packagedScript: Object.hasOwn(setup, 'scriptTempRelativePath'),
          externalScript:
            Object.hasOwn(setup, 'scriptFilePath') ||
            Object.hasOwn(setup, 'unpackagedScriptFilePath'),
        }
      : {
          predictionSettingsType: text(prediction.predictionSettingsType),
          outcomeName: text(prediction.outcomeName),
          ...(typeof prediction.topPredictors === 'number'
            ? { topPredictors: prediction.topPredictors }
            : {}),
          ...(typeof prediction.topImprovements === 'number'
            ? { topImprovements: prediction.topImprovements }
            : {}),
          modelDefinitionPresent: prediction.predictionDefinition != null,
          connectionPresent: prediction.connectionId != null,
        },
    ...(script
      ? {}
      : {
          fieldMappings: Object.entries(object(prediction.fieldMappings)).map(
            ([inputField, target]) => ({
              inputField,
              modelField: text(object(target).name) ?? text(target),
            }),
          ),
        }),
    inputFields: before.map((field) => ({
      ...field,
      role: used.includes(field.name) ? 'explicit-reference' : 'provided',
    })),
    usedFields: used,
    outputFields: after,
    schemaStatus: observed
      ? 'observed'
      : script
        ? (evidence?.schemaStatus ?? 'deferred')
        : 'native-rule',
    dependencyStatus: script ? (fn?.dependencyStatus ?? 'unknown') : 'model-mapping',
    ...(evidence ? { sourceSha256: evidence.sourceSha256 } : {}),
    nativeExecutionVerified: false,
  };
  return result;
}
