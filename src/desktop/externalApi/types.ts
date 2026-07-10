import { z } from 'zod';

/**
 * Types and schemas for the Tableau Desktop "External Client API" (Athena V0).
 *
 * Contract derived from monolith PRs #57536 → #59383 (ApiRoutePaths.h + handlers,
 * PR #59238 head 88276855). Where the exact wire shape was not fully pinned down by
 * the PR evidence, schemas are intentionally permissive (`.passthrough()` /
 * optional fields) and the ambiguity is recorded as residual risk in the deliverable
 * report. A live `/openapi.json` diff is the intended follow-up to tighten these.
 */

/** Route paths served by the running Desktop loopback host. */
export const EXTERNAL_API_ROUTES = {
  health: '/v0/health',
  app: '/v0/app',
  workbookDocument: '/v0/workbook/document',
  invokeCommand: '/v0/app:invokeCommand',
  openapi: '/openapi.json',
  oauthProtectedResource: '/.well-known/oauth-protected-resource',
} as const;

/** Response headers on `GET /v0/workbook/document`. Matched case-insensitively. */
export const HEADER_APPLICATION_VERSION = 'x-tableau-application-version';
export const HEADER_XSD_PAYLOAD_VERSION = 'x-tableau-xsd-payload-version';

/**
 * Discovery file written by Desktop to `<OS app-local-data>/ExternalApi/<pid>.json`.
 * Only `schemaVersion === 1` is understood. Version fields are optional so a slightly
 * newer/older build still parses; the essentials (pid/baseUrl/token) are required.
 */
export const discoveryFileSchema = z.object({
  schemaVersion: z.literal(1),
  instanceId: z.string(),
  pid: z.number(),
  baseUrl: z.string().url(),
  tokenType: z.string().optional(),
  token: z.string(),
  applicationVersion: z.string().optional(),
  apiVersion: z.string().optional(),
  startedAt: z.string().optional(),
});
export type DiscoveryFile = z.infer<typeof discoveryFileSchema>;

/** A live, reachable External Client API instance selected from discovery. */
export type ExternalApiInstance = {
  baseUrl: string;
  token: string;
  pid: number;
  instanceId: string;
  apiVersion?: string;
};

/** RFC-7807-style Problem codes surfaced by the API's error model. */
export const PROBLEM_CODES = [
  'invalid-request-body',
  'unsupported-content-type',
  'command-not-found',
  'invalid-command-parameter',
  'operation-failed',
] as const;
export type ProblemCode = (typeof PROBLEM_CODES)[number];

/** RFC-7807 Problem response body. `code` carries the API-specific error code. */
export const problemResponseSchema = z
  .object({
    type: z.string().optional(),
    title: z.string().optional(),
    status: z.number().optional(),
    detail: z.string().optional(),
    code: z.string().optional(),
  })
  .passthrough();
export type ProblemResponse = z.infer<typeof problemResponseSchema>;

/**
 * Operation envelope returned by `POST /v0/workbook/document` and
 * `POST /v0/app:invokeCommand`. `result` is captured on success; `state` +
 * `createdAt`/`completedAt` (ISO8601-Z) describe the operation lifecycle.
 */
export const operationEnvelopeSchema = z
  .object({
    operationId: z.string().optional(),
    state: z.string().optional(),
    result: z.unknown().optional(),
    error: problemResponseSchema.optional(),
    createdAt: z.string().optional(),
    completedAt: z.string().optional(),
  })
  .passthrough();
export type OperationEnvelope = z.infer<typeof operationEnvelopeSchema>;

/** Typed error surfaced by {@link ExternalApiClient} methods. */
export type ExternalApiError =
  | { type: 'unauthorized'; status: number }
  | { type: 'problem'; status: number; code?: string; title?: string; detail?: string }
  | { type: 'invalid-response'; error: unknown }
  | { type: 'network'; error: unknown };
