import { z } from 'zod';

/**
 * Types and schemas for the Tableau Desktop "External Client API" (Athena V0).
 *
 * Contract derived from the External Client API rollout, then tightened against the
 * live `/openapi.json` (OpenAPI 3.1, `info.version` 0.1.0, captured 2026-07-20)
 * plus live probes against the running 0.1.0 build. Envelope fields the
 * spec marks required are required here; everything else stays permissive
 * (`.passthrough()` / optional) because the spec is read-complete but write-thin.
 */

/** Route paths served by the running Desktop loopback host. */
export const EXTERNAL_API_ROUTES = {
  health: '/v0/health',
  app: '/v0/app',
  root: '/v0/',
  workbook: '/v0/workbook',
  workbookDashboards: '/v0/workbook/dashboards',
  workbookDatasources: '/v0/workbook/datasources',
  workbookDocument: '/v0/workbook/document',
  workbookDocumentValidate: '/v0/workbook/document:validate',
  workbookStoryboards: '/v0/workbook/storyboards',
  workbookWorksheets: '/v0/workbook/worksheets',
  workbookUndo: '/v0/workbook:undo',
  workbookRedo: '/v0/workbook:redo',
  workbookGoToSheet: '/v0/workbook:goToSheet',
  dashboardById: '/v0/workbook/dashboards/{id}',
  dashboardDocument: '/v0/workbook/dashboards/{id}/document',
  dashboardImage: '/v0/workbook/dashboards/{id}/image',
  dashboardDelete: '/v0/workbook/dashboards/{id}:delete',
  dashboardRename: '/v0/workbook/dashboards/{id}:rename',
  storyboardById: '/v0/workbook/storyboards/{id}',
  storyboardDocument: '/v0/workbook/storyboards/{id}/document',
  storyboardDelete: '/v0/workbook/storyboards/{id}:delete',
  storyboardRename: '/v0/workbook/storyboards/{id}:rename',
  worksheetById: '/v0/workbook/worksheets/{id}',
  worksheetDocument: '/v0/workbook/worksheets/{id}/document',
  worksheetImage: '/v0/workbook/worksheets/{id}/image',
  worksheetSummaryData: '/v0/workbook/worksheets/{id}/summaryData',
  worksheetLogicalTables: '/v0/workbook/worksheets/{id}/logicalTables',
  worksheetLogicalTableData: '/v0/workbook/worksheets/{id}/logicalTables/{logicalTableId}/data',
  worksheetDelete: '/v0/workbook/worksheets/{id}:delete',
  worksheetRename: '/v0/workbook/worksheets/{id}:rename',
  worksheetSort: '/v0/workbook/worksheets/{id}:sort',
  site: '/v0/site',
  siteDatasources: '/v0/site/datasources',
  siteWorkbooks: '/v0/site/workbooks',
  invokeCommand: '/v0/app:invokeCommand',
  operations: '/v0/operations',
  operationById: '/v0/operations/{id}',
  openapi: '/openapi.json',
  oauthProtectedResource: '/.well-known/oauth-protected-resource',
} as const;

/** Response headers on `GET /v0/workbook/document`. Matched case-insensitively. */
export const HEADER_APPLICATION_VERSION = 'x-tableau-application-version';
export const HEADER_XSD_PAYLOAD_VERSION = 'x-tableau-xsd-payload-version';

/** Query accepted by {@link worksheetSummaryDataRoute}. */
export type WorksheetSummaryDataQuery = {
  maxRows?: number;
  ignoreAliases?: boolean;
  ignoreSelection?: boolean;
  /**
   * Field names restricting the returned columns. Each becomes its own repeated
   * `columnsToIncludeByFieldName` query pair — the API does not comma-split, so a
   * field name may itself contain a comma.
   */
  columnsToIncludeByFieldName?: Array<string>;
};

/** Query accepted by {@link worksheetLogicalTableDataRoute}. */
export type WorksheetUnderlyingDataQuery = WorksheetSummaryDataQuery & {
  includeAllColumns?: boolean;
};

/** The three sheet kinds whose `:rename`/`:delete` action routes hang under distinct path prefixes. */
export type SheetKind = 'worksheet' | 'dashboard' | 'storyboard';

/** A sheet targeted by an id-addressed action route, tagged with its kind's path prefix. */
export type SheetRef = {
  kind: SheetKind;
  id: string;
};

/** Body of `POST /v0/workbook/worksheets/{id}:sort`. `fieldName` is required; the rest default server-side. */
export type WorksheetSort = {
  fieldName: string;
  direction?: 'asc' | 'desc';
  sortType?: 'data-source-order' | 'alpha';
  clearSort?: boolean;
};

/** Query accepted by {@link worksheetImageRoute} and {@link dashboardImageRoute}. */
export type ImageExportQuery = {
  /**
   * Absolute path the Desktop host should persist the image to. When set, the response
   * projects `filePath` instead of `imageBase64`. Desktop rejects a relative path or one
   * containing `..` with a 400 before dispatching.
   */
  filePath?: string;
  /** Image MIME type. Desktop defaults to `image/png`; `image/svg+xml` and raster formats accepted. */
  mimeType?: string;
};

// Concrete `{id}` routes are built here, next to the constants, so the HTTP layer never
// mentions an endpoint. Ids ride the path segment and must be percent-encoded.

export function worksheetRoute(worksheetId: string): string {
  return `${EXTERNAL_API_ROUTES.workbookWorksheets}/${encodeURIComponent(worksheetId)}`;
}

export function dashboardRoute(dashboardId: string): string {
  return `${EXTERNAL_API_ROUTES.workbookDashboards}/${encodeURIComponent(dashboardId)}`;
}

export function storyboardRoute(storyboardId: string): string {
  return `${EXTERNAL_API_ROUTES.workbookStoryboards}/${encodeURIComponent(storyboardId)}`;
}

export function worksheetDocumentRoute(worksheetId: string): string {
  return `${worksheetRoute(worksheetId)}/document`;
}

export function dashboardDocumentRoute(dashboardId: string): string {
  return `${dashboardRoute(dashboardId)}/document`;
}

export function storyboardDocumentRoute(storyboardId: string): string {
  return `${storyboardRoute(storyboardId)}/document`;
}

export function worksheetSummaryDataRoute(
  worksheetId: string,
  query: WorksheetSummaryDataQuery,
): string {
  const search = new URLSearchParams();
  if (query.maxRows !== undefined) {
    search.set('maxRows', String(query.maxRows));
  }
  if (query.ignoreAliases !== undefined) {
    search.set('ignoreAliases', String(query.ignoreAliases));
  }
  if (query.ignoreSelection !== undefined) {
    search.set('ignoreSelection', String(query.ignoreSelection));
  }
  for (const column of query.columnsToIncludeByFieldName ?? []) {
    search.append('columnsToIncludeByFieldName', column);
  }

  const suffix = search.size > 0 ? `?${search.toString()}` : '';
  return `${worksheetRoute(worksheetId)}/summaryData${suffix}`;
}

const SHEET_ROUTE_PREFIX: Record<SheetKind, string> = {
  worksheet: EXTERNAL_API_ROUTES.workbookWorksheets,
  dashboard: EXTERNAL_API_ROUTES.workbookDashboards,
  storyboard: EXTERNAL_API_ROUTES.workbookStoryboards,
};

export function sheetActionRoute(sheet: SheetRef, action: 'rename' | 'delete'): string {
  return `${SHEET_ROUTE_PREFIX[sheet.kind]}/${encodeURIComponent(sheet.id)}:${action}`;
}

export function worksheetSortRoute(worksheetId: string): string {
  return `${worksheetRoute(worksheetId)}:sort`;
}

export function worksheetLogicalTablesRoute(worksheetId: string): string {
  return `${worksheetRoute(worksheetId)}/logicalTables`;
}

export function worksheetLogicalTableDataRoute(
  worksheetId: string,
  logicalTableId: string,
  query: WorksheetUnderlyingDataQuery,
): string {
  const search = new URLSearchParams();
  if (query.maxRows !== undefined) {
    search.set('maxRows', String(query.maxRows));
  }
  if (query.ignoreAliases !== undefined) {
    search.set('ignoreAliases', String(query.ignoreAliases));
  }
  if (query.ignoreSelection !== undefined) {
    search.set('ignoreSelection', String(query.ignoreSelection));
  }
  if (query.includeAllColumns !== undefined) {
    search.set('includeAllColumns', String(query.includeAllColumns));
  }
  for (const column of query.columnsToIncludeByFieldName ?? []) {
    search.append('columnsToIncludeByFieldName', column);
  }

  const suffix = search.size > 0 ? `?${search.toString()}` : '';
  return `${worksheetRoute(worksheetId)}/logicalTables/${encodeURIComponent(
    logicalTableId,
  )}/data${suffix}`;
}

// Builds the `?filePath=…&mimeType=…` suffix with encodeURIComponent (percent-encoding),
// NOT URLSearchParams: URLSearchParams encodes a space as '+', which some servers decode
// back to a space only for form bodies — for a path a stray '+' is ambiguous. Percent-encoding
// (`%20`) round-trips a space unambiguously through the host's query decoder.
function imageQuerySuffix(query: ImageExportQuery): string {
  const parts: string[] = [];
  if (query.filePath !== undefined) {
    parts.push(`filePath=${encodeURIComponent(query.filePath)}`);
  }
  if (query.mimeType !== undefined) {
    parts.push(`mimeType=${encodeURIComponent(query.mimeType)}`);
  }
  return parts.length > 0 ? `?${parts.join('&')}` : '';
}

export function worksheetImageRoute(worksheetId: string, query: ImageExportQuery): string {
  return `${worksheetRoute(worksheetId)}/image${imageQuerySuffix(query)}`;
}

export function dashboardImageRoute(dashboardId: string, query: ImageExportQuery): string {
  return `${dashboardRoute(dashboardId)}/image${imageQuerySuffix(query)}`;
}

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

/** API versions and link map returned by `GET /v0/`. */
export const apiRootSchema = z
  .object({
    apiVersion: z.string().optional(),
    applicationVersion: z.string().optional(),
    links: z.record(z.string()).optional(),
  })
  .passthrough();
export type ApiRoot = z.infer<typeof apiRootSchema>;

/** Liveness probe returned by `GET /v0/health`. */
export const healthSchema = z
  .object({
    status: z.string().optional(),
  })
  .passthrough();

/** Connected Tableau site returned by `GET /v0/site`. */
export const siteSchema = z
  .object({
    siteId: z.string().optional(),
    authenticatedUserId: z.string().optional(),
  })
  .passthrough();
export type Site = z.infer<typeof siteSchema>;

/** RFC-9728 OAuth Protected Resource Metadata returned by the well-known route. */
export const protectedResourceMetadataSchema = z
  .object({
    authorization_servers: z.array(z.string()).optional(),
    bearer_methods_supported: z.array(z.string()).optional(),
  })
  .passthrough();
export type ProtectedResourceMetadata = z.infer<typeof protectedResourceMetadataSchema>;

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
  'logical-table-not-found',
  'operation-pending',
  'method-not-allowed',
  'not-implemented',
  'command-not-found',
  'invalid-command-parameter',
  'invalid-query-parameter',
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

/** A modal window blocking the command queue, reported on an Operation that cannot progress. */
export const windowInfoSchema = z
  .object({
    objectName: z.string(),
    title: z.string(),
    className: z.string(),
    messageText: z.string().optional(),
    informativeText: z.string().optional(),
    detailedText: z.string().optional(),
    iconLevel: z.string().optional(),
    buttons: z.array(z.string()).optional(),
  })
  .passthrough();
export type WindowInfo = z.infer<typeof windowInfoSchema>;

/**
 * Operation envelope returned by `POST /v0/workbook/document`, `POST /v0/app:invokeCommand`,
 * and the `GET /v0/operations/{id}` poll route. Only `id`/`kind`/`state` are required here even
 * though the 0.2.0 spec also lists `createdAt`/`updatedAt`/`warnings`: the executor reads those
 * fail-open (`createdAt ?? now`, `warnings` only when present), so a partial or slightly-older
 * envelope must still parse rather than error. `result` rides only a SUCCEEDED envelope with
 * non-null command output.
 */
export const operationEnvelopeSchema = z
  .object({
    id: z.string(),
    kind: z.string(),
    state: z.string(),
    result: z.record(z.string(), z.unknown()).optional(),
    error: operationErrorSchema.optional(),
    warnings: z.array(operationWarningSchema).optional(),
    blockingWindows: z.array(windowInfoSchema).optional(),
    createdAt: z.string().optional(),
    updatedAt: z.string().optional(),
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

/** Dashboard list returned by `GET /v0/workbook/dashboards`. */
export const dashboardListSchema = z
  .object({
    dashboards: z.array(dashboardItemSchema).optional(),
  })
  .passthrough();
export type DashboardList = z.infer<typeof dashboardListSchema>;

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

/** Storyboard list returned by `GET /v0/workbook/storyboards`. */
export const storyboardListSchema = z
  .object({
    storyboards: z.array(storyboardItemSchema).optional(),
  })
  .passthrough();
export type StoryboardList = z.infer<typeof storyboardListSchema>;

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
    // Server LUID of the datasource; present only for a published, non-federated datasource and null
    // otherwise. Same field as the luid on `GET /v0/site/datasources`, but nullable here (["string",
    // "null"]) because the workbook endpoint emits null for embedded/federated datasources, whereas
    // the site endpoint's luid is a plain string.
    luid: z.string().nullish(),
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

/** One logical table available for a worksheet's underlying data. */
export const logicalTableItemSchema = z
  .object({
    id: z.string().optional(),
    caption: z.string().optional(),
  })
  .passthrough();
export type LogicalTableItem = z.infer<typeof logicalTableItemSchema>;

/** Logical table list returned by `GET /v0/workbook/worksheets/{id}/logicalTables`. */
export const logicalTableListSchema = z
  .object({
    tables: z.array(logicalTableItemSchema).optional(),
  })
  .passthrough();
export type LogicalTableList = z.infer<typeof logicalTableListSchema>;

/** Validation result returned by `POST /v0/workbook/document:validate`. */
export const validationResultSchema = z
  .object({
    isValid: z.boolean(),
    validationIssues: z.array(z.string()).optional(),
  })
  .passthrough();
export type ValidationResult = z.infer<typeof validationResultSchema>;

/**
 * Image export result returned by `GET /v0/workbook/worksheets/{id}/image` and
 * `GET /v0/workbook/dashboards/{id}/image`. Always includes `width`/`height`, plus
 * `imageBase64` XOR `filePath`: base64 bytes when no server-side output path was
 * requested, otherwise the absolute path written (bytes omitted). Both bytes/path
 * fields stay optional so a partial or evolved envelope still parses; callers pick
 * the branch to render.
 *
 * `effectiveMimeType` is the server-declared ACTUAL rendered format (post any
 * server-side fallback), not the requested one — it is authoritative for the label
 * the tool emits on the inline image block. The render format is constrained to
 * `image/png` or `image/svg+xml`. The live server sends it on every rendered response.
 * It stays optional for parse-safety: (1) the field is being added to the
 * server async, so a build that predates it must still parse (a required field would
 * fail `safeParse` and error the whole export, not just mislabel); (2) the degenerate
 * "neither bytes nor path" envelope legitimately carries no rendered format. When absent,
 * blank, or not `image/svg+xml`, the block is labelled `image/png`.
 */
export const imageResultSchema = z
  .object({
    imageBase64: z.string().optional(),
    filePath: z.string().optional(),
    width: z.number().optional(),
    height: z.number().optional(),
    effectiveMimeType: z.string().optional(),
  })
  .passthrough();
export type ImageResult = z.infer<typeof imageResultSchema>;

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
 * Typed error surfaced by {@link ExternalApiHttp} methods. The internal
 * `'unauthorized'` variant corresponds to the wire code `'unauthenticated'` —
 * mapped at the 401 boundary; the internal name is kept (many refs).
 */
export type ExternalApiError =
  | { type: 'unauthorized'; status: number }
  | { type: 'problem'; status: number; code?: string; title?: string; detail?: string }
  | { type: 'invalid-response'; error: unknown }
  | { type: 'network'; error: unknown; aborted?: boolean }
  // 503: retry the whole request (there is no operation to poll).
  | { type: 'operation-pending'; retryAfterSeconds?: number }
  // Blocked on a human; a poll can never clear it.
  | { type: 'awaiting-user'; operationId?: string }
  | { type: 'operation-expired'; operationId?: string }
  | { type: 'poll-timeout'; operationId?: string };
