/**
 * Route-safe Zod schemas for REST path parameters and tool ID arguments.
 *
 * Every `:param` in a Zodios endpoint path should be declared with `pathParam(...)` so its value is
 * validated before it reaches the URL. `pathParams.test.ts` enforces this for every endpoint.
 */
import { z } from 'zod';

import { assertLuid, assertSafePathSegment, LUID_PATTERN } from './core.js';

/**
 * Tableau LUID schema for tool arguments. Fails with a normal Zod issue, so the MCP SDK reports a
 * bad argument as an input-validation error before the tool callback runs.
 *
 * An explicit 8-4-4-4-12 hex pattern rather than `z.string().uuid()`, whose strictness differs
 * between zod v3 (lenient) and v4 (RFC 9562 version/variant checks).
 */
export const luidSchema = z.string().regex(LUID_PATTERN, 'must be a Tableau LUID (UUID format)');

/**
 * Zodios endpoint parameter definition for a strictly-validated path parameter.
 *
 * - `luid` (default): Tableau LUID. Validated on the raw value; never decoded first.
 * - `segment`: any value that is a single safe path segment (for non-LUID IDs such as knowledge
 *   node IDs, which `knowledgeMethods` percent-encodes before they reach Zodios).
 *
 * Why `:siteId` is declared as `segment`, not `luid`: the site ID is never agent input. It is
 * server-supplied, taken from the sign-in / session response, and is a LUID in practice. `segment`
 * still blocks traversal if that value were ever malformed, without making a working session fail
 * on an unexpected-but-harmless site ID format. Agent-supplied IDs must use `luid`.
 *
 * The schema THROWS `RouteSafetyError` instead of reporting a Zod issue. Zodios's own
 * `zod-validation` plugin runs before the route guards and would otherwise wrap a failure in a
 * `ZodiosError` carrying the raw value; a thrown exception escapes `safeParse` (zod v3), so every
 * path-param rejection surfaces as the same `RouteSafetyError` type, named but never echoed.
 */
export const pathParam = <N extends string>(name: N, kind: 'luid' | 'segment' = 'luid') =>
  ({
    name,
    type: 'Path',
    schema: z.custom<string>((v) => {
      if (kind === 'luid') {
        assertLuid(name, v);
      } else {
        assertSafePathSegment(name, v);
      }
      return true;
    }),
  }) as const;
