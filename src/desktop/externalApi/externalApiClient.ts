import { Err, Ok, Result } from 'ts-results-es';
import { z } from 'zod';

import {
  ApiRoot,
  apiRootSchema,
  AppInfo,
  appInfoSchema,
  DashboardItem,
  dashboardItemSchema,
  DashboardList,
  dashboardListSchema,
  DatasourceList,
  datasourceListSchema,
  EXTERNAL_API_ROUTES,
  ExternalApiError,
  ExternalApiInstance,
  HEADER_APPLICATION_VERSION,
  HEADER_XSD_PAYLOAD_VERSION,
  ImageResult,
  imageResultSchema,
  OperationEnvelope,
  operationEnvelopeSchema,
  problemResponseSchema,
  Site,
  SiteDatasourceList,
  siteDatasourceListSchema,
  siteSchema,
  SiteWorkbookList,
  siteWorkbookListSchema,
  StoryboardItem,
  storyboardItemSchema,
  StoryboardList,
  storyboardListSchema,
  SummaryData,
  summaryDataSchema,
  ValidationResult,
  validationResultSchema,
  WorkbookInventory,
  workbookInventorySchema,
  WorksheetItem,
  worksheetItemSchema,
  WorksheetList,
  worksheetListSchema,
} from './types.js';

export type ExternalApiClientOptions = {
  /** Injectable fetch — defaults to the global. Tests pass real HTTP to a mock server. */
  fetchFn?: typeof fetch;
  /** Global ceiling for each request; health remains capped at its shorter route budget. */
  timeoutMs?: number;
  /** Overall wall-clock ceiling for a 202→poll loop, separate from the per-fetch timeout. */
  pollDeadlineMs?: number;
};

export type WorkbookDocument = {
  xml: string;
  applicationVersion: string | undefined;
  xsdPayloadVersion: string | undefined;
};

export type WorksheetSummaryDataQuery = {
  maxRows?: number;
  ignoreAliases?: boolean;
  ignoreSelection?: boolean;
  columnsToIncludeByFieldName?: string;
};

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

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_HEALTH_TIMEOUT_MS = 10_000;

// Bounds the whole 202→poll loop. Deliberately larger than the per-fetch timeout so async dispatch
// does not regress the max operation length it exists to enable.
const DEFAULT_POLL_DEADLINE_MS = 300_000;
const DEFAULT_RETRY_AFTER_SECONDS = 1;
const HTTP_ACCEPTED = 202;
const HTTP_SERVICE_UNAVAILABLE = 503;

// Wire states are UPPER_SNAKE_CASE; unknown values count as non-terminal per the spec.
const TERMINAL_STATES = new Set(['SUCCEEDED', 'FAILED', 'CANCELLED']);

function isTerminalState(state: string | undefined): boolean {
  return state !== undefined && TERMINAL_STATES.has(state.toUpperCase());
}

const HEADER_LOCATION = 'location';
const HEADER_RETRY_AFTER = 'retry-after';
const HEADER_OPERATION_ID = 'x-tableau-operation-id';

/**
 * Typed client for a single Tableau Desktop External Client API instance.
 *
 * Bound to one {@link ExternalApiInstance} (baseUrl + token). Pure transport: the
 * Bearer token is attached to every request and Problem responses are surfaced as
 * typed {@link ExternalApiError}s (401 → `unauthorized`, so callers can rescan).
 */
export class ExternalApiClient {
  private readonly instance: ExternalApiInstance;
  private readonly fetchFn: typeof fetch;
  private readonly timeoutMs: number | undefined;
  private readonly pollDeadlineMs: number;

  constructor(instance: ExternalApiInstance, options: ExternalApiClientOptions = {}) {
    this.instance = instance;
    this.fetchFn = options.fetchFn ?? fetch;
    this.timeoutMs = options.timeoutMs;
    this.pollDeadlineMs = options.pollDeadlineMs ?? DEFAULT_POLL_DEADLINE_MS;
  }

  get baseUrl(): string {
    return this.instance.baseUrl;
  }

  get pid(): number {
    return this.instance.pid;
  }

  get instanceId(): string {
    return this.instance.instanceId;
  }

  get apiVersion(): string | undefined {
    return this.instance.apiVersion;
  }

  async health(signal?: AbortSignal): Promise<Result<{ healthy: boolean }, ExternalApiError>> {
    const response = await this.request('GET', EXTERNAL_API_ROUTES.health, { signal });
    if (response.isErr()) {
      return Err(response.error);
    }
    return Ok({ healthy: response.value.ok });
  }

  async getWorkbookDocument(
    signal?: AbortSignal,
  ): Promise<Result<WorkbookDocument, ExternalApiError>> {
    return this.getXml(EXTERNAL_API_ROUTES.workbookDocument, signal);
  }

  async applyWorkbookDocument(
    xml: string,
    signal?: AbortSignal,
  ): Promise<Result<OperationEnvelope, ExternalApiError>> {
    const response = await this.request('POST', EXTERNAL_API_ROUTES.workbookDocument, {
      signal,
      contentType: 'application/xml',
      body: xml,
    });
    return this.parseEnvelope(response, signal);
  }

  async validateWorkbookDocument(
    xml: string,
    signal?: AbortSignal,
  ): Promise<Result<ValidationResult, ExternalApiError>> {
    const response = await this.request('POST', EXTERNAL_API_ROUTES.workbookDocumentValidate, {
      signal,
      contentType: 'application/xml',
      body: xml,
    });
    return this.parseJson(response, validationResultSchema);
  }

  async invokeCommand(
    namespace: string,
    command: string,
    params: Record<string, unknown> = {},
    signal?: AbortSignal,
  ): Promise<Result<OperationEnvelope, ExternalApiError>> {
    const response = await this.request('POST', EXTERNAL_API_ROUTES.invokeCommand, {
      signal,
      contentType: 'application/json',
      body: JSON.stringify({ namespace, command, parameters: params }),
    });
    return this.parseEnvelope(response, signal);
  }

  async fetchOpenApi(signal?: AbortSignal): Promise<Result<unknown, ExternalApiError>> {
    const response = await this.request('GET', EXTERNAL_API_ROUTES.openapi, { signal });
    if (response.isErr()) {
      return Err(response.error);
    }

    const res = response.value;
    if (!res.ok) {
      return Err(await mapErrorResponse(res));
    }

    try {
      return Ok(await res.json());
    } catch (error) {
      return Err({ type: 'invalid-response', error });
    }
  }

  async getRoot(signal?: AbortSignal): Promise<Result<ApiRoot, ExternalApiError>> {
    return this.getJson(EXTERNAL_API_ROUTES.root, apiRootSchema, signal);
  }

  async listWorksheets(signal?: AbortSignal): Promise<Result<WorksheetList, ExternalApiError>> {
    return this.getJson(EXTERNAL_API_ROUTES.workbookWorksheets, worksheetListSchema, signal);
  }

  async listDashboards(signal?: AbortSignal): Promise<Result<DashboardList, ExternalApiError>> {
    return this.getJson(EXTERNAL_API_ROUTES.workbookDashboards, dashboardListSchema, signal);
  }

  async listStoryboards(signal?: AbortSignal): Promise<Result<StoryboardList, ExternalApiError>> {
    return this.getJson(EXTERNAL_API_ROUTES.workbookStoryboards, storyboardListSchema, signal);
  }

  async getWorkbook(signal?: AbortSignal): Promise<Result<WorkbookInventory, ExternalApiError>> {
    return this.getJson(EXTERNAL_API_ROUTES.workbook, workbookInventorySchema, signal);
  }

  async listWorkbookDatasources(
    signal?: AbortSignal,
  ): Promise<Result<DatasourceList, ExternalApiError>> {
    return this.getJson(EXTERNAL_API_ROUTES.workbookDatasources, datasourceListSchema, signal);
  }

  async listSiteWorkbooks(
    signal?: AbortSignal,
  ): Promise<Result<SiteWorkbookList, ExternalApiError>> {
    return this.getJson(EXTERNAL_API_ROUTES.siteWorkbooks, siteWorkbookListSchema, signal);
  }

  async getSite(signal?: AbortSignal): Promise<Result<Site, ExternalApiError>> {
    return this.getJson(EXTERNAL_API_ROUTES.site, siteSchema, signal);
  }

  async getWorksheet(
    worksheetId: string,
    signal?: AbortSignal,
  ): Promise<Result<WorksheetItem, ExternalApiError>> {
    return this.getJson(buildWorksheetByIdRoute(worksheetId), worksheetItemSchema, signal);
  }

  async getDashboard(
    dashboardId: string,
    signal?: AbortSignal,
  ): Promise<Result<DashboardItem, ExternalApiError>> {
    return this.getJson(buildDashboardByIdRoute(dashboardId), dashboardItemSchema, signal);
  }

  async getStoryboard(
    storyboardId: string,
    signal?: AbortSignal,
  ): Promise<Result<StoryboardItem, ExternalApiError>> {
    return this.getJson(buildStoryboardByIdRoute(storyboardId), storyboardItemSchema, signal);
  }

  async getWorksheetDocument(
    worksheetId: string,
    signal?: AbortSignal,
  ): Promise<Result<WorkbookDocument, ExternalApiError>> {
    return this.getXml(buildWorksheetDocumentRoute(worksheetId), signal);
  }

  async getDashboardDocument(
    dashboardId: string,
    signal?: AbortSignal,
  ): Promise<Result<WorkbookDocument, ExternalApiError>> {
    return this.getXml(buildDashboardDocumentRoute(dashboardId), signal);
  }

  async getStoryboardDocument(
    storyboardId: string,
    signal?: AbortSignal,
  ): Promise<Result<WorkbookDocument, ExternalApiError>> {
    return this.getXml(buildStoryboardDocumentRoute(storyboardId), signal);
  }

  async getApp(signal?: AbortSignal): Promise<Result<AppInfo, ExternalApiError>> {
    return this.getJson(EXTERNAL_API_ROUTES.app, appInfoSchema, signal);
  }

  async getWorksheetSummaryData(
    worksheetId: string,
    query: WorksheetSummaryDataQuery = {},
    signal?: AbortSignal,
  ): Promise<Result<SummaryData, ExternalApiError>> {
    return this.getJson(
      buildWorksheetSummaryDataRoute(worksheetId, query),
      summaryDataSchema,
      signal,
    );
  }

  async exportWorksheetImage(
    worksheetId: string,
    query: ImageExportQuery = {},
    signal?: AbortSignal,
  ): Promise<Result<ImageResult, ExternalApiError>> {
    return this.getJson(buildWorksheetImageRoute(worksheetId, query), imageResultSchema, signal);
  }

  async exportDashboardImage(
    dashboardId: string,
    query: ImageExportQuery = {},
    signal?: AbortSignal,
  ): Promise<Result<ImageResult, ExternalApiError>> {
    return this.getJson(buildDashboardImageRoute(dashboardId, query), imageResultSchema, signal);
  }

  async listSiteDatasources(
    signal?: AbortSignal,
  ): Promise<Result<SiteDatasourceList, ExternalApiError>> {
    return this.getJson(EXTERNAL_API_ROUTES.siteDatasources, siteDatasourceListSchema, signal);
  }

  private async parseEnvelope(
    response: Result<Response, ExternalApiError>,
    signal?: AbortSignal,
  ): Promise<Result<OperationEnvelope, ExternalApiError>> {
    if (response.isErr()) {
      return Err(response.error);
    }

    if (response.value.status === HTTP_ACCEPTED) {
      return this.pollOperation(response.value, signal);
    }

    return this.parseJson(response, operationEnvelopeSchema);
  }

  /** Blocks on the 202's `Location` until a terminal Operation; AWAITING_USER returns `awaiting-user`. */
  private async pollOperation(
    accepted: Response,
    signal?: AbortSignal,
  ): Promise<Result<OperationEnvelope, ExternalApiError>> {
    const location = accepted.headers.get(HEADER_LOCATION);
    const operationId = accepted.headers.get(HEADER_OPERATION_ID) ?? undefined;
    if (!location) {
      return Err({ type: 'invalid-response', error: 'A 202 response carried no Location header.' });
    }

    let retryAfterMs = parseRetryAfterMs(accepted.headers.get(HEADER_RETRY_AFTER));
    const deadline = Date.now() + this.pollDeadlineMs;

    for (;;) {
      if (Date.now() >= deadline) {
        return Err({ type: 'poll-timeout', operationId });
      }

      await delay(retryAfterMs, signal);

      const polled = await this.request('GET', location, { signal });
      if (polled.isErr()) {
        return Err(polled.error);
      }

      const res = polled.value;
      if (res.status === 404) {
        return Err({ type: 'operation-expired', operationId });
      }
      if (!res.ok) {
        return Err(await mapErrorResponse(res));
      }

      const parsed = await parseOperationBody(res);
      if (parsed.isErr()) {
        return Err(parsed.error);
      }

      const envelope = parsed.value;
      const state = envelope.state?.toUpperCase();
      if (state === 'AWAITING_USER') {
        return Err({ type: 'awaiting-user', operationId: envelope.id ?? operationId });
      }
      if (isTerminalState(envelope.state)) {
        return Ok(envelope);
      }

      retryAfterMs = parseRetryAfterMs(res.headers.get(HEADER_RETRY_AFTER));
    }
  }

  private async getJson<T extends z.ZodTypeAny>(
    route: string,
    schema: T,
    signal?: AbortSignal,
  ): Promise<Result<z.infer<T>, ExternalApiError>> {
    const response = await this.request('GET', route, { signal });
    return this.parseJson(response, schema);
  }

  private async parseJson<T extends z.ZodTypeAny>(
    response: Result<Response, ExternalApiError>,
    schema: T,
  ): Promise<Result<z.infer<T>, ExternalApiError>> {
    if (response.isErr()) {
      return Err(response.error);
    }

    const res = response.value;
    const overflow = await readOverflowError(res);
    if (overflow) {
      return Err(overflow);
    }
    if (!res.ok) {
      return Err(await mapErrorResponse(res));
    }

    let json: unknown;
    try {
      json = await res.json();
    } catch (error) {
      return Err({ type: 'invalid-response', error });
    }

    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      return Err({ type: 'invalid-response', error: parsed.error });
    }
    return Ok(parsed.data);
  }

  private async getXml(
    route: string,
    signal?: AbortSignal,
  ): Promise<Result<WorkbookDocument, ExternalApiError>> {
    const response = await this.request('GET', route, { signal });
    if (response.isErr()) {
      return Err(response.error);
    }

    const res = response.value;
    const overflow = await readOverflowError(res);
    if (overflow) {
      return Err(overflow);
    }
    if (!res.ok) {
      return Err(await mapErrorResponse(res));
    }

    try {
      const xml = await res.text();
      return Ok({
        xml,
        applicationVersion: res.headers.get(HEADER_APPLICATION_VERSION) ?? undefined,
        xsdPayloadVersion: res.headers.get(HEADER_XSD_PAYLOAD_VERSION) ?? undefined,
      });
    } catch (error) {
      return Err({ type: 'invalid-response', error });
    }
  }

  private async request(
    method: 'GET' | 'POST',
    route: string,
    options: { signal?: AbortSignal; contentType?: string; body?: string },
  ): Promise<Result<Response, ExternalApiError>> {
    const headers: Record<string, string> = {
      authorization: `Bearer ${this.instance.token}`,
    };
    if (options.contentType) {
      headers['content-type'] = options.contentType;
    }

    // A caller signal is a cancellation channel, not a clock — compose, never replace. `??` here
    // meant the default timeout never applied, because every desktop tool passes extra.signal.
    const signal = composeWithTimeout(options.signal, timeoutMsForRoute(route, this.timeoutMs));

    try {
      const res = await this.fetchFn(this.url(route), {
        method,
        headers,
        body: options.body,
        signal,
      });
      return Ok(res);
    } catch (error) {
      return Err({ type: 'network', error, aborted: signal.aborted });
    }
  }

  private url(route: string): string {
    return `${this.instance.baseUrl.replace(/\/$/, '')}${route}`;
  }
}

function composeWithTimeout(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

// `Retry-After` is an integer number of seconds (RFC 9110 §10.2.3); the HTTP-date form is not emitted here.
function parseRetryAfterMs(headerValue: string | null): number {
  const seconds = Number.parseInt(headerValue ?? '', 10);
  return (Number.isFinite(seconds) && seconds >= 0 ? seconds : DEFAULT_RETRY_AFTER_SECONDS) * 1000;
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function parseOperationBody(
  res: Response,
): Promise<Result<OperationEnvelope, ExternalApiError>> {
  let json: unknown;
  try {
    json = await res.json();
  } catch (error) {
    return Err({ type: 'invalid-response', error });
  }
  const parsed = operationEnvelopeSchema.safeParse(json);
  if (!parsed.success) {
    return Err({ type: 'invalid-response', error: parsed.error });
  }
  return Ok(parsed.data);
}

// A typed read's payload is unreachable by polling, so an overflow (202) is a terminal error here,
// not a poll trigger like it is on the write path. A 503 is only an `operation-pending` precursor
// overflow when its Problem code says so — a genuine api-disabled/shutting-down 503 must fall
// through to mapErrorResponse and keep its real code.
async function readOverflowError(res: Response): Promise<ExternalApiError | undefined> {
  if (res.status === HTTP_ACCEPTED) {
    return {
      type: 'read-overflowed',
      operationId: res.headers.get(HEADER_OPERATION_ID) ?? undefined,
    };
  }
  if (res.status === HTTP_SERVICE_UNAVAILABLE && (await problemCode(res)) === 'operation-pending') {
    const seconds = Number.parseInt(res.headers.get(HEADER_RETRY_AFTER) ?? '', 10);
    return {
      type: 'operation-pending',
      retryAfterSeconds: Number.isFinite(seconds) ? seconds : undefined,
    };
  }
  return undefined;
}

// Reads a clone so the body stays available for mapErrorResponse on the fall-through path.
async function problemCode(res: Response): Promise<string | undefined> {
  try {
    const problem = problemResponseSchema.safeParse(JSON.parse(await res.clone().text()));
    return problem.success ? problem.data.code : undefined;
  } catch {
    return undefined;
  }
}

function timeoutMsForRoute(route: string, configuredTimeoutMs: number | undefined): number {
  const globalTimeoutMs = configuredTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  return route === EXTERNAL_API_ROUTES.health
    ? Math.min(globalTimeoutMs, DEFAULT_HEALTH_TIMEOUT_MS)
    : globalTimeoutMs;
}

function buildWorksheetByIdRoute(worksheetId: string): string {
  return `${EXTERNAL_API_ROUTES.workbookWorksheets}/${encodeURIComponent(worksheetId)}`;
}

function buildDashboardByIdRoute(dashboardId: string): string {
  return `${EXTERNAL_API_ROUTES.workbookDashboards}/${encodeURIComponent(dashboardId)}`;
}

function buildStoryboardByIdRoute(storyboardId: string): string {
  return `${EXTERNAL_API_ROUTES.workbookStoryboards}/${encodeURIComponent(storyboardId)}`;
}

function buildWorksheetDocumentRoute(worksheetId: string): string {
  return `${EXTERNAL_API_ROUTES.workbookWorksheets}/${encodeURIComponent(worksheetId)}/document`;
}

function buildDashboardDocumentRoute(dashboardId: string): string {
  return `${EXTERNAL_API_ROUTES.workbookDashboards}/${encodeURIComponent(dashboardId)}/document`;
}

function buildStoryboardDocumentRoute(storyboardId: string): string {
  return `${EXTERNAL_API_ROUTES.workbookStoryboards}/${encodeURIComponent(storyboardId)}/document`;
}

function buildWorksheetSummaryDataRoute(
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
  if (query.columnsToIncludeByFieldName !== undefined) {
    search.set('columnsToIncludeByFieldName', query.columnsToIncludeByFieldName);
  }

  const suffix = search.size > 0 ? `?${search.toString()}` : '';
  return `${EXTERNAL_API_ROUTES.workbookWorksheets}/${encodeURIComponent(
    worksheetId,
  )}/summaryData${suffix}`;
}

// Builds the `?filePath=…&mimeType=…` suffix with encodeURIComponent (percent-encoding),
// NOT URLSearchParams: URLSearchParams encodes a space as '+', which some servers decode
// back to a space only for form bodies — for a path a stray '+' is ambiguous. Percent-encoding
// (`%20`) round-trips a space unambiguously through the host's query decoder.
function buildImageQuerySuffix(query: ImageExportQuery): string {
  const parts: string[] = [];
  if (query.filePath !== undefined) {
    parts.push(`filePath=${encodeURIComponent(query.filePath)}`);
  }
  if (query.mimeType !== undefined) {
    parts.push(`mimeType=${encodeURIComponent(query.mimeType)}`);
  }
  return parts.length > 0 ? `?${parts.join('&')}` : '';
}

function buildWorksheetImageRoute(worksheetId: string, query: ImageExportQuery): string {
  return `${EXTERNAL_API_ROUTES.workbookWorksheets}/${encodeURIComponent(
    worksheetId,
  )}/image${buildImageQuerySuffix(query)}`;
}

function buildDashboardImageRoute(dashboardId: string, query: ImageExportQuery): string {
  return `${EXTERNAL_API_ROUTES.workbookDashboards}/${encodeURIComponent(
    dashboardId,
  )}/image${buildImageQuerySuffix(query)}`;
}

async function mapErrorResponse(res: Response): Promise<ExternalApiError> {
  if (res.status === 401) {
    return { type: 'unauthorized', status: 401 };
  }

  const text = await res.text().catch(() => '');
  let problem: ReturnType<typeof problemResponseSchema.safeParse> | undefined;
  try {
    problem = problemResponseSchema.safeParse(JSON.parse(text));
  } catch {
    problem = undefined;
  }

  if (problem?.success) {
    return {
      type: 'problem',
      status: res.status,
      code: problem.data.code,
      title: problem.data.title,
      detail: problem.data.detail ?? (text || undefined),
    };
  }

  return {
    type: 'problem',
    status: res.status,
    detail: text || res.statusText || undefined,
  };
}
