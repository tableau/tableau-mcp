import { toInputJsonSchema, ToolParamsSchema, toStandardSchema } from '../../toolContext.js';

/**
 * Reproduces what the server advertises as a tool's `inputSchema`: the registration adapter wraps
 * the raw params shape in z.object(), then the SDK's tools/list converts it with the schema's
 * Standard JSON Schema hook (draft 2020-12, input side).
 *
 * Used in tests to assert the *advertised* schema — not just runtime parsing — has non-empty
 * `properties`. This is the exact bug fixed by flattening the knowledge tools' discriminated
 * union schemas: a z.discriminatedUnion (or a .superRefine wrapper around one) has no top-level
 * `.shape`, so the advertised schema previously came out as `{"type":"object","properties":{}}`.
 */
export function advertisedInputSchema(paramsShape: ToolParamsSchema): Record<string, unknown> {
  return toInputJsonSchema(toStandardSchema(paramsShape));
}
