/**
 * Route-safe Zod schemas for REST path parameters and tool ID arguments.
 *
 * Every `:param` in a Zodios endpoint path should be declared with `pathParam(...)` so its value is
 * validated before it reaches the URL. `pathParams.test.ts` enforces this for every endpoint.
 */
import { z } from 'zod';

import { assertSafePathSegment } from './core.js';

/**
 * - `luid`: Tableau LUID (UUID). Validated on the raw value; never decoded first.
 * - `segment`: any value that is a single safe path segment (for non-LUID IDs such as knowledge
 *   node IDs or Pulse `definitions:batchGet`-style values).
 *
 * Why `:siteId` is declared as `segment`, not `luid`: the site ID is never agent input. It is
 * server-supplied, taken from the sign-in / session response, and is a LUID in practice. `segment`
 * still blocks traversal if that value were ever malformed, without making a working session fail
 * on an unexpected-but-harmless site ID format. Agent-supplied IDs must use `luid`.
 */
export type IdKind = 'luid' | 'segment';

const schemas = {
  luid: z.string().uuid('must be a Tableau LUID (UUID format)'),
  segment: z.string().superRefine((v, ctx) => {
    try {
      assertSafePathSegment('value', v);
    } catch (e) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: (e as Error).message });
    }
  }),
} as const satisfies Record<IdKind, z.ZodTypeAny>;

const routeSafeSchemas = new WeakSet<z.ZodTypeAny>(Object.values(schemas));

/** Returns the shared route-safe schema for an ID kind. */
export const idSchema = <K extends IdKind>(kind: K): (typeof schemas)[K] => schemas[kind];

/** True if `schema` was produced by `idSchema` (used by the path-param enforcement test). */
export const isRouteSafeSchema = (schema: unknown): boolean =>
  typeof schema === 'object' && schema !== null && routeSafeSchemas.has(schema as z.ZodTypeAny);

/** Zodios endpoint parameter definition for a strictly-validated path parameter. */
export const pathParam = <N extends string, K extends IdKind = 'luid'>(name: N, kind?: K) =>
  ({ name, type: 'Path', schema: idSchema((kind ?? 'luid') as K) }) as const;

/** Tableau LUID (UUID) schema. Alias of `idSchema('luid')`. */
export const luidSchema = idSchema('luid');

/** Alias of `pathParam(name, 'luid')`. */
export const luidPathParam = <N extends string>(name: N) =>
  ({ name, type: 'Path', schema: luidSchema }) as const;
