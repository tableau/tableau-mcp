import { FlowDocument } from '../types/flowDocument.js';
import { PrepScriptContext } from '../types/prepScript.js';

type ScriptReference = {
  nodeId: string;
  nodeType: string;
  language: 'python' | 'r';
  entry: string;
  function?: string;
};
const obj = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

/** Match only the native packaged-node convention. External paths/URLs are data,
 * never destinations to open. Multiple path forms and duplicate node IDs refuse. */
export function packagedScriptReferences(document: FlowDocument): ScriptReference[] {
  const result = new Map<string, ScriptReference>(),
    duplicates = new Set<string>(),
    seen = new Set<string>();
  const pending: Array<{ value: unknown; depth: number }> = [{ value: document, depth: 0 }];
  let visits = 0;
  while (pending.length) {
    const { value, depth } = pending.pop()!;
    if (++visits > 100000 || depth > 40) return [];
    if (Array.isArray(value)) {
      pending.push(...value.map((child) => ({ value: child, depth: depth + 1 })));
      continue;
    }
    const node = obj(value),
      setup = obj(node.setupParameters),
      execution = obj(node.executionParameters);
    if (
      typeof node.nodeType === 'string' &&
      node.nodeType.endsWith('.ExtensibilityNode') &&
      typeof node.id === 'string'
    ) {
      if (seen.has(node.id)) duplicates.add(node.id);
      seen.add(node.id);
      const service = node.externalServiceType;
      const relative = setup.scriptTempRelativePath;
      const forms = ['scriptFilePath', 'unpackagedScriptFilePath', 'scriptTempRelativePath'].filter(
        (key) => Object.hasOwn(setup, key),
      );
      const parts = typeof relative === 'string' ? relative.split('/') : [];
      if (
        forms.length === 1 &&
        forms[0] === 'scriptTempRelativePath' &&
        ['pythonSupport', 'rSupport'].includes(String(service)) &&
        parts.length === 2 &&
        parts[0] === node.id &&
        parts.every(
          (part) =>
            part &&
            !['.', '..'].includes(part) &&
            !part.includes('\\') &&
            ![...part].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127),
        ) &&
        node.id.length <= 1024
      ) {
        result.set(node.id, {
          nodeId: node.id,
          nodeType: node.nodeType,
          language: service === 'pythonSupport' ? 'python' : 'r',
          entry: `Extensibility/${service}/${relative}`,
          ...(typeof execution.scriptFunctionName === 'string'
            ? { function: execution.scriptFunctionName }
            : {}),
        });
        if (result.size > 100) return [];
      }
    }
    for (const child of Object.values(node))
      if (child !== null && typeof child === 'object')
        pending.push({ value: child, depth: depth + 1 });
  }
  return [...result.values()].filter((ref) => !duplicates.has(ref.nodeId));
}

/** API and native downloads are independent reads. A script context attaches only
 * when its exact node type/language/path/function agree with the API document. */
export function matchPrepScriptContext(
  api: FlowDocument,
  native: FlowDocument,
  context: PrepScriptContext,
): PrepScriptContext {
  const nativeRefs = new Map(packagedScriptReferences(native).map((ref) => [ref.nodeId, ref]));
  const scripts = Object.fromEntries(
    packagedScriptReferences(api).flatMap((ref) => {
      const other = nativeRefs.get(ref.nodeId);
      const evidence = Object.hasOwn(context.scripts, ref.nodeId)
        ? context.scripts[ref.nodeId]
        : undefined;
      return other &&
        evidence &&
        evidence.language === ref.language &&
        JSON.stringify(ref) === JSON.stringify(other)
        ? [[ref.nodeId, evidence]]
        : [];
    }),
  );
  return {
    scripts,
    ...(context.packageSha256 ? { packageSha256: context.packageSha256 } : {}),
    ...(context.unavailable
      ? {
          unavailable: Object.fromEntries(
            packagedScriptReferences(api).flatMap((ref) => {
              const other = nativeRefs.get(ref.nodeId);
              return other &&
                JSON.stringify(ref) === JSON.stringify(other) &&
                Object.hasOwn(context.unavailable!, ref.nodeId)
                ? [[ref.nodeId, context.unavailable![ref.nodeId]]]
                : [];
            }),
          ),
        }
      : {}),
  };
}
