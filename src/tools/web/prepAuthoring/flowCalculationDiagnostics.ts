import { z } from 'zod';

import { isObject, Json, Obj, object } from './compactYaml.js';
import {
  MAX_PREP_CALCULATION_DIAGNOSTICS,
  prepCalculationDiagnosticSchema,
  validatePrepCalculation,
} from './prepCalculationLanguage.js';

export const flowCalculationDiagnosticSchema = prepCalculationDiagnosticSchema.extend({
  path: z.string().max(4096),
});
type Diagnostic = z.infer<typeof flowCalculationDiagnosticSchema>;
type Calculation = { path: string; expression: Json | undefined };

function* calculations(value: Json | undefined, path: string): Generator<Calculation> {
  if (Array.isArray(value)) {
    for (const [index, child] of value.entries()) yield* calculations(child, `${path}/${index}`);
  } else if (isObject(value)) {
    if (
      typeof value.nodeType === 'string' &&
      (/^\.v\d+(?:_\d+)*\.AddColumn$/.test(value.nodeType) ||
        (/^\.v\d+(?:_\d+)*\.MultiRowCalc$/.test(value.nodeType) &&
          Object.hasOwn(value, 'expression')))
    ) {
      yield { path: `${path}/expression`, expression: value.expression };
    }
    for (const [key, child] of Object.entries(value)) {
      const segment = key.replaceAll('~', '~0').replaceAll('/', '~1');
      yield* calculations(child, `${path}/${segment}`);
    }
  }
}

export function changedCalculationDiagnostics(
  document: Obj,
  loadBaseline: () => Obj,
): { count: number; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];
  let count = 0;
  let originals: Map<string, Json | undefined> | undefined;
  for (const { path, expression } of calculations(object(document.flow).nodes, '/flow/nodes')) {
    const issues = validatePrepCalculation(typeof expression === 'string' ? expression : '');
    if (!issues.length) continue;
    // Look up the validated base project only when a formula would otherwise block preview.
    originals ??= new Map(
      [...calculations(object(loadBaseline().flow).nodes, '/flow/nodes')].map((calculation) => [
        calculation.path,
        calculation.expression,
      ]),
    );
    if (originals.has(path) && originals.get(path) === expression) continue;
    count += issues.length;
    for (const issue of issues) {
      if (diagnostics.length >= MAX_PREP_CALCULATION_DIAGNOSTICS) break;
      diagnostics.push({ ...issue, path: path.slice(0, 4096) });
    }
  }
  return { count, diagnostics };
}
