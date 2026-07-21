import { z } from 'zod';

/**
 * Types and schemas for the Tableau Desktop "External Client API" (Athena V0).
 *
 * Contract originally derived from monolith PRs #57536 → #59383, then tightened
 * against the live `/openapi.json` (OpenAPI 3.1, `info.version` 0.1.0, captured
 * 2026-07-20) plus live probes against the running 0.1.0 build. Envelope fields the
 * spec marks required are required here; everything else stays permissive
 * (`.passthrough()` / optional) because the spec is read-complete but write-thin.
 */

/** Route paths served by the running Desktop loopback host. */
export const EXTERNAL_API_ROUTES = {
  health: '/v0/health',
  app: '/v0/app',
  workbook: '/v0/workbook',
  workbookDatasources: '/v0/workbook/datasources',
  workbookDocument: '/v0/workbook/document',
  workbookWorksheets: '/v0/workbook/worksheets',
  worksheetById: '/v0/workbook/worksheets/{id}',
  worksheetSummaryData: '/v0/workbook/worksheets/{id}/summaryData',
  siteDatasources: '/v0/site/datasources',
  siteWorkbooks: '/v0/site/workbooks',
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

/**
 * RFC-9457 Problem `code` values — the `x-extensible-enum` from the live
 * `/openapi.json` (0.1.0). Extensible on the wire: treat unknown codes as valid.
 */
export const PROBLEM_CODES = [
  'api-disabled',
  'host-not-allowed',
  'origin-not-allowed',
  'unauthenticated',
  'missing-user-agent',
  'invalid-request-body',
  'unsupported-content-type',
  'missing-payload-version',
  'payload-version-unsupported',
  'not-found',
  'sheet-not-found',
  'method-not-allowed',
  'not-implemented',
  'command-not-found',
  'invalid-command-parameter',
  'operation-failed',
] as const;
export type ProblemCode = (typeof PROBLEM_CODES)[number];

/**
 * RFC-9457 Problem Details body. The spec requires `code`/`status`/`instance`, but
 * this schema keeps every field optional so error extraction fails open — a Problem
 * we can only partially parse should still surface its `code`/`title`, never fall
 * back to raw text. (`instance` population is unverified on the live build; `detail`
 * is an RFC-9457 member the spec omits but `additionalProperties: true` allows.)
 */
export const problemResponseSchema = z
  .object({
    type: z.string().optional(),
    title: z.string().optional(),
    status: z.number().optional(),
    instance: z.string().optional(),
    detail: z.string().optional(),
    code: z.string().optional(),
  })
  .passthrough();
export type ProblemResponse = z.infer<typeof problemResponseSchema>;

/** Operation-level `error` — distinct from {@link problemResponseSchema} (HTTP-level). */
export const operationErrorSchema = z
  .object({
    code: z.string(),
    message: z.string().optional(),
  })
  .passthrough();
export type OperationError = z.infer<typeof operationErrorSchema>;

/** Non-fatal warning attached to an Operation. */
export const operationWarningSchema = z
  .object({
    code: z.string(),
    message: z.string(),
  })
  .passthrough();
export type OperationWarning = z.infer<typeof operationWarningSchema>;

/**
 * Operation envelope returned by `POST /v0/workbook/document` and
 * `POST /v0/app:invokeCommand`. `id`/`kind`/`state` are required per the spec.
 * `result` is ABSENT from the spec's Operation schema but kept optional here until
 * output-param behavior is confirmed with the API owner (Ask 1(b)) — do not tighten
 * it out, and do not rely on it being populated.
 */
export const operationEnvelopeSchema = z
  .object({
    id: z.string(),
    kind: z.string(),
    state: z.string(),
    result: z.unknown().optional(),
    error: operationErrorSchema.optional(),
    warnings: z.array(operationWarningSchema).optional(),
    createdAt: z.string().optional(),
    completedAt: z.string().optional(),
  })
  .passthrough();
export type OperationEnvelope = z.infer<typeof operationEnvelopeSchema>;

/** Worksheet item returned by `GET /v0/workbook/worksheets`. */
export const worksheetItemSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    type: z.string().optional(),
    hidden: z.boolean(),
    index: z.number().int().optional(),
    datasources: z.array(z.string()).optional(),
  })
  .passthrough();
export type WorksheetItem = z.infer<typeof worksheetItemSchema>;

/** Worksheet list returned by `GET /v0/workbook/worksheets`. */
export const worksheetListSchema = z
  .object({
    worksheets: z.array(worksheetItemSchema).optional(),
  })
  .passthrough();
export type WorksheetList = z.infer<typeof worksheetListSchema>;

/** Dashboard item returned in workbook inventory reads. */
export const dashboardItemSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    type: z.string().optional(),
    hidden: z.boolean(),
    index: z.number().int().optional(),
    containedSheets: z.array(z.string()).optional(),
  })
  .passthrough();
export type DashboardItem = z.infer<typeof dashboardItemSchema>;

/** Storyboard item returned in workbook inventory reads. */
export const storyboardItemSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    type: z.string().optional(),
    hidden: z.boolean(),
    index: z.number().int().optional(),
    storyPointCount: z.number().int().optional(),
  })
  .passthrough();
export type StoryboardItem = z.infer<typeof storyboardItemSchema>;

/** Metadata and sheet inventory returned by `GET /v0/workbook`. */
export const workbookInventorySchema = z
  .object({
    title: z.string(),
    location: z.string().nullable().optional(),
    unsavedChanges: z.boolean(),
    worksheets: z.array(worksheetItemSchema).optional(),
    dashboards: z.array(dashboardItemSchema).optional(),
    storyboards: z.array(storyboardItemSchema).optional(),
  })
  .passthrough();
export type WorkbookInventory = z.infer<typeof workbookInventorySchema>;

/** Workbook datasource item returned by `GET /v0/workbook/datasources`. */
export const datasourceItemSchema = z
  .object({
    id: z.string().optional(),
    name: z.string().optional(),
    caption: z.string().optional(),
  })
  .passthrough();
export type DatasourceItem = z.infer<typeof datasourceItemSchema>;

/** Workbook datasource list returned by `GET /v0/workbook/datasources`. */
export const datasourceListSchema = z
  .object({
    datasources: z.array(datasourceItemSchema).optional(),
  })
  .passthrough();
export type DatasourceList = z.infer<typeof datasourceListSchema>;

/** Published workbook item returned by `GET /v0/site/workbooks`. */
export const siteWorkbookItemSchema = z
  .object({
    id: z.string().optional(),
    luid: z.string().optional(),
    name: z.string().optional(),
    project: z.string().optional(),
  })
  .passthrough();
export type SiteWorkbookItem = z.infer<typeof siteWorkbookItemSchema>;

/** Published workbook list returned by `GET /v0/site/workbooks`. */
export const siteWorkbookListSchema = z
  .object({
    workbooks: z.array(siteWorkbookItemSchema).optional(),
  })
  .passthrough();
export type SiteWorkbookList = z.infer<typeof siteWorkbookListSchema>;

/** Published datasource item returned by `GET /v0/site/datasources`. */
export const siteDatasourceItemSchema = z
  .object({
    id: z.string().optional(),
    luid: z.string().optional(),
    name: z.string().optional(),
    caption: z.string().optional(),
    project: z.string().optional(),
  })
  .passthrough();
export type SiteDatasourceItem = z.infer<typeof siteDatasourceItemSchema>;

/** Published datasource list returned by `GET /v0/site/datasources`. */
export const siteDatasourceListSchema = z
  .object({
    datasources: z.array(siteDatasourceItemSchema).optional(),
  })
  .passthrough();
export type SiteDatasourceList = z.infer<typeof siteDatasourceListSchema>;

/** Worksheet summary logical table returned by `GET /v0/workbook/worksheets/{id}/summaryData`. */
export const summaryDataSchema = z
  .object({
    columns: z
      .array(
        z
          .object({
            name: z.string().optional(),
            dataType: z.string().optional(),
          })
          .passthrough(),
      )
      .optional(),
    rows: z.array(z.array(z.unknown())).optional(),
  })
  .passthrough();
export type SummaryData = z.infer<typeof summaryDataSchema>;

/** Running Desktop application info returned by `GET /v0/app`. */
export const appInfoSchema = z
  .object({
    applicationVersion: z.string().optional(),
    edition: z.string().optional(),
    build: z.string().optional(),
    os: z.string().optional(),
    locale: z.string().optional(),
    repositoryLocation: z.string().optional(),
    logLocation: z.string().optional(),
  })
  .passthrough();
export type AppInfo = z.infer<typeof appInfoSchema>;

/**
 * Typed error surfaced by {@link ExternalApiClient} methods. The internal
 * `'unauthorized'` variant corresponds to the wire code `'unauthenticated'` —
 * mapped at the 401 boundary; the internal name is kept (many refs).
 */
export type ExternalApiError =
  | { type: 'unauthorized'; status: number }
  | { type: 'problem'; status: number; code?: string; title?: string; detail?: string }
  | { type: 'invalid-response'; error: unknown }
  | { type: 'network'; error: unknown };
