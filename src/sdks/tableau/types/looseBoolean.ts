import { z } from 'zod';

/**
 * Parses a boolean that may arrive as a real boolean or as a string, resolving
 * anything unrecognized (or absent) to `false`.
 *
 * Do NOT use `z.coerce.boolean()` here: coercion delegates to `Boolean(value)`,
 * which maps the string "false" to `true` and would invert the caller's branch.
 *
 * The `false` fallback lives inside the transform rather than in a trailing
 * `.catch()` / `.default()`, neither of which would fire: on a `z.unknown()`
 * base a transform returning `undefined` still *succeeds*, so `.catch()` never
 * sees a failure, and `.default()` only substitutes for an `undefined` input.
 *
 * Because the transform's output type is `boolean`, a field using this schema
 * infers as a REQUIRED `boolean` on the output side while still accepting an
 * absent key on the input side.
 */
export const looseBooleanFalsy = z.unknown().transform((value) => {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') {
      return true;
    }
    if (normalized === 'false') {
      return false;
    }
  }
  return false;
});
