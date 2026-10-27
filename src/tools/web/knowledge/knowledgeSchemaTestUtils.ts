import { objectFromShape, ZodRawShapeCompat } from '@modelcontextprotocol/sdk/server/zod-compat.js';
import { toJsonSchemaCompat } from '@modelcontextprotocol/sdk/server/zod-json-schema-compat.js';

/**
 * Reproduces exactly what the MCP SDK does to advertise a tool's `inputSchema` to clients (see
 * `_createRegisteredTool` / `ListToolsRequestSchema` handler in
 * `@modelcontextprotocol/sdk/server/mcp.js`):
 *
 * 1. Registration time: a raw params shape is converted to a real Zod object via
 *    `objectFromShape` (`getZodSchemaObject`).
 * 2. Listing time: `normalizeObjectSchema` is a no-op once the schema already has a `.shape`, then
 *    `toJsonSchemaCompat` converts it to JSON Schema with the same options the SDK uses.
 *
 * Used in tests to assert the *advertised* schema — not just runtime parsing — has non-empty
 * `properties`. This is the exact bug fixed by flattening the knowledge tools' discriminated
 * union schemas: a z.discriminatedUnion (or a .superRefine wrapper around one) has no top-level
 * `.shape`, so this same conversion previously produced `{"type":"object","properties":{}}`.
 */
export function advertisedInputSchema(paramsShape: ZodRawShapeCompat): Record<string, unknown> {
  const objectSchema = objectFromShape(paramsShape);
  return toJsonSchemaCompat(objectSchema, {
    strictUnions: true,
    pipeStrategy: 'input',
  }) as Record<string, unknown>;
}
