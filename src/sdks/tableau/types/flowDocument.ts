import { z } from 'zod';

/**
 * Sanitized flow document returned by the experimental
 * `GET /api/exp/sites/:siteId/flows/:flowId/document` endpoint.
 *
 * The real document is large and, because the endpoint is experimental, its
 * shape may evolve. We therefore validate only the handful of structural fields
 * the describe-flow summarizer reads and keep everything permissive: every
 * object uses `.passthrough()` and nearly every field is optional. The endpoint
 * already strips credentials/secrets and redacts email-shaped PII server-side,
 * so nothing sensitive is expected here.
 */

export const flowDocumentNodeNextNodeSchema = z
  .object({
    nextNodeId: z.string().optional(),
    namespace: z.string().optional(),
    nextNamespace: z.string().optional(),
  })
  .passthrough();

export const flowDocumentFieldSchema = z
  .object({
    name: z.string().optional(),
    type: z.string().optional(),
  })
  .passthrough();

export const flowDocumentNodeSchema = z
  .object({
    id: z.string().optional(),
    name: z.string().optional(),
    // e.g. ".v1.LoadCsv", ".v1.Join", ".v1.PublishExtract"
    nodeType: z.string().optional(),
    // e.g. "input", "output", "transform", "superNode"
    baseType: z.string().optional(),
    connectionId: z.string().optional(),
    nextNodes: z.array(flowDocumentNodeNextNodeSchema).optional(),
    fields: z.array(flowDocumentFieldSchema).optional(),
  })
  .passthrough();

/**
 * Parses `isPackaged`, which may arrive as a real boolean or as a string. We do
 * NOT use `z.coerce.boolean()` here: coercion delegates to `Boolean(value)`,
 * which maps the string "false" to `true` and would invert packaged status.
 * Instead we accept actual booleans as-is and interpret the case-insensitive
 * strings "true"/"false" correctly; any other / missing value yields
 * `undefined` (the field is optional and the document shape is permissive).
 */
const looseBooleanSchema = z
  .unknown()
  .transform((value) => {
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
    return undefined;
  })
  .optional();

export const flowDocumentConnectionSchema = z
  .object({
    id: z.string().optional(),
    // e.g. ".v1.SqlConnection", ".v1.FileConnection"
    connectionType: z.string().optional(),
    name: z.string().optional(),
    isPackaged: looseBooleanSchema,
    // Descriptive topology (class, server, dbname, filename, ...). Credentials are
    // stripped server-side, so we read these freely but keep the shape open.
    connectionAttributes: z.record(z.unknown()).optional(),
  })
  .passthrough();

export const flowDocumentSchema = z
  .object({
    nodes: z.record(flowDocumentNodeSchema).optional(),
    initialNodes: z.array(z.string()).optional(),
    connections: z.record(flowDocumentConnectionSchema).optional(),
    dataConnections: z.record(flowDocumentConnectionSchema).optional(),
    parameters: z
      .object({
        parameters: z.record(z.unknown()).optional(),
      })
      .passthrough()
      .optional(),
    majorVersion: z.number().optional(),
    minorVersion: z.number().optional(),
    documentId: z.string().optional(),
  })
  .passthrough();

export type FlowDocumentNextNode = z.infer<typeof flowDocumentNodeNextNodeSchema>;
export type FlowDocumentField = z.infer<typeof flowDocumentFieldSchema>;
export type FlowDocumentNode = z.infer<typeof flowDocumentNodeSchema>;
export type FlowDocumentConnection = z.infer<typeof flowDocumentConnectionSchema>;
export type FlowDocument = z.infer<typeof flowDocumentSchema>;
