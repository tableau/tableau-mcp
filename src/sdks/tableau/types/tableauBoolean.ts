import { z } from 'zod';

/**
 * Safely parses a boolean from a Tableau REST response.
 *
 * Tableau's JSON responses usually return booleans as real JSON booleans, but some endpoints (and
 * the XML-derived responses) deliver them as the strings `"true"`/`"false"`. `z.coerce.boolean()`
 * is a footgun for the stringified case because `Boolean("false") === true`, which would silently
 * mis-credit a value (e.g. treat an uncertified clone as certified, or a nested project as
 * top-level). This preprocessor treats only a real `true` or the case-insensitive string `"true"`
 * as `true`; every other value — including `"false"`, `"0"`, `""`, and non-boolean types — is
 * `false`. Wrap with `.optional()` to preserve an absent field as `undefined`.
 */
export const tableauBooleanSchema = z.preprocess((value) => {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    return value.trim().toLowerCase() === 'true';
  }
  return false;
}, z.boolean());
