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
  site: '/v0/site',
  siteDatasources: '/v0/site/datasources',
  siteWorkbooks: '/v0/site/workbooks',
  workbook: '/v0/workbook',
  workbookDocument: '/v0/workbook/document',
  workbookDocumentValidate: '/v0/workbook/document:validate',
  workbookDatasources: '/v0/workbook/datasources',
  worksheets: '/v0/workbook/worksheets',
  dashboards: '/v0/workbook/dashboards',
  storyboards: '/v0/workbook/storyboards',
  invokeCommand: '/v0/app:invokeCommand',
  openapi: '/openapi.json',
  oauthProtectedResource: '/.well-known/oauth-protected-resource',
} as const;

/** `{collection}/{id}` and `{collection}/{id}/document` build off each collection base. */
const itemRoute =
  (base: string) =>
  (id: string): string =>
    `${base}/${encodeURIComponent(id)}`;
const documentRoute =
  (base: string) =>
  (id: string): string =>
    `${base}/${encodeURIComponent(id)}/document`;

export const worksheetItemRoute = itemRoute(EXTERNAL_API_ROUTES.worksheets);
export const worksheetDocumentRoute = documentRoute(EXTERNAL_API_ROUTES.worksheets);
export const worksheetSummaryDataRoute = (id: string): string =>
  `${EXTERNAL_API_ROUTES.worksheets}/${encodeURIComponent(id)}/summaryData`;
export const dashboardItemRoute = itemRoute(EXTERNAL_API_ROUTES.dashboards);
export const dashboardDocumentRoute = documentRoute(EXTERNAL_API_ROUTES.dashboards);
export const storyboardItemRoute = itemRoute(EXTERNAL_API_ROUTES.storyboards);
export const storyboardDocumentRoute = documentRoute(EXTERNAL_API_ROUTES.storyboards);

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
 * Problem `code` values the API documents (RFC 9457). Open set: the spec marks `code` an
 * `x-extensible-enum`, so `problemResponseSchema` accepts any string and this list is the
 * known set callers may branch on.
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

/** RFC 9457 Problem response body. `code` carries the API-specific error code. */
export const problemResponseSchema = z
  .object({
    type: z.string().optional(),
    title: z.string().optional(),
    status: z.number().optional(),
    detail: z.string().optional(),
    instance: z.string().optional(),
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
    id: z.string().optional(),
    kind: z.string().optional(),
    operationId: z.string().optional(),
    state: z.string().optional(),
    result: z.unknown().optional(),
    error: problemResponseSchema.optional(),
    warnings: z.array(z.unknown()).optional(),
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

/** A worksheet in the open workbook (`GET /v0/workbook/worksheets`). Addressed by `id`. */
export const worksheetItemSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    hidden: z.boolean(),
    type: z.string().optional(),
    index: z.number().optional(),
    datasources: z.array(z.string()).optional(),
  })
  .passthrough();
export type WorksheetItem = z.infer<typeof worksheetItemSchema>;

export const worksheetListSchema = z
  .object({ worksheets: z.array(worksheetItemSchema) })
  .passthrough();
export type WorksheetList = z.infer<typeof worksheetListSchema>;

/** A dashboard in the open workbook (`GET /v0/workbook/dashboards`). Addressed by `id`. */
export const dashboardItemSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    hidden: z.boolean(),
    type: z.string().optional(),
    index: z.number().optional(),
    containedSheets: z.array(z.string()).optional(),
  })
  .passthrough();
export type DashboardItem = z.infer<typeof dashboardItemSchema>;

export const dashboardListSchema = z
  .object({ dashboards: z.array(dashboardItemSchema) })
  .passthrough();
export type DashboardList = z.infer<typeof dashboardListSchema>;

/** Worksheet summary (logical table) data (`GET /v0/workbook/worksheets/{id}/summaryData`). */
export const summaryDataSchema = z
  .object({
    columns: z
      .array(
        z.object({ name: z.string().optional(), dataType: z.string().optional() }).passthrough(),
      )
      .optional(),
    rows: z.array(z.array(z.unknown())).optional(),
  })
  .passthrough();
export type SummaryData = z.infer<typeof summaryDataSchema>;

/** A storyboard in the open workbook (`GET /v0/workbook/storyboards`). Addressed by `id`. */
export const storyboardItemSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    hidden: z.boolean(),
    type: z.string().optional(),
    index: z.number().optional(),
    storyPointCount: z.number().optional(),
  })
  .passthrough();
export type StoryboardItem = z.infer<typeof storyboardItemSchema>;

export const storyboardListSchema = z
  .object({ storyboards: z.array(storyboardItemSchema) })
  .passthrough();
export type StoryboardList = z.infer<typeof storyboardListSchema>;

/** The connected Tableau site (`GET /v0/site`). */
export const siteSchema = z
  .object({ siteId: z.string().optional(), authenticatedUserId: z.string().optional() })
  .passthrough();
export type Site = z.infer<typeof siteSchema>;

/** A datasource published to the connected site (`GET /v0/site/datasources`). */
export const siteDatasourceItemSchema = z
  .object({
    id: z.string().optional(),
    luid: z.string().optional(),
    name: z.string().optional(),
    caption: z.string().optional(),
    project: z.string().optional(),
  })
  .passthrough();
export const siteDatasourceListSchema = z
  .object({ datasources: z.array(siteDatasourceItemSchema) })
  .passthrough();
export type SiteDatasourceList = z.infer<typeof siteDatasourceListSchema>;

/** A workbook published to the connected site (`GET /v0/site/workbooks`). */
export const siteWorkbookItemSchema = z
  .object({
    id: z.string().optional(),
    luid: z.string().optional(),
    name: z.string().optional(),
    project: z.string().optional(),
  })
  .passthrough();
export const siteWorkbookListSchema = z
  .object({ workbooks: z.array(siteWorkbookItemSchema) })
  .passthrough();
export type SiteWorkbookList = z.infer<typeof siteWorkbookListSchema>;

/** A datasource used by the open workbook (`GET /v0/workbook/datasources`). */
export const datasourceItemSchema = z
  .object({
    id: z.string().optional(),
    name: z.string().optional(),
    caption: z.string().optional(),
  })
  .passthrough();
export const datasourceListSchema = z
  .object({ datasources: z.array(datasourceItemSchema) })
  .passthrough();
export type DatasourceList = z.infer<typeof datasourceListSchema>;

/** Metadata and sheet inventory of the open workbook (`GET /v0/workbook`). */
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

/** Outcome of `POST /v0/workbook/document:validate`. */
export const validationResultSchema = z
  .object({
    isValid: z.boolean(),
    validationIssues: z.array(z.string()).optional(),
  })
  .passthrough();
export type ValidationResult = z.infer<typeof validationResultSchema>;
