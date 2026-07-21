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
  /** Per-request timeout used when the caller does not supply an AbortSignal. */
  timeoutMs?: number;
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

const DEFAULT_TIMEOUT_MS = 60_000;

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
  private readonly timeoutMs: number;

  constructor(instance: ExternalApiInstance, options: ExternalApiClientOptions = {}) {
    this.instance = instance;
    this.fetchFn = options.fetchFn ?? fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
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
    return this.parseEnvelope(response);
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
      // Field name `parameters` is a best-guess from the PR contract — see report.
      body: JSON.stringify({ namespace, command, parameters: params }),
    });
    return this.parseEnvelope(response);
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

  async listSiteDatasources(
    signal?: AbortSignal,
  ): Promise<Result<SiteDatasourceList, ExternalApiError>> {
    return this.getJson(EXTERNAL_API_ROUTES.siteDatasources, siteDatasourceListSchema, signal);
  }

  private async parseEnvelope(
    response: Result<Response, ExternalApiError>,
  ): Promise<Result<OperationEnvelope, ExternalApiError>> {
    if (response.isErr()) {
      return Err(response.error);
    }

    return this.parseJson(response, operationEnvelopeSchema);
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

    const signal = options.signal ?? AbortSignal.timeout(this.timeoutMs);

    try {
      const res = await this.fetchFn(this.url(route), {
        method,
        headers,
        body: options.body,
        signal,
      });
      return Ok(res);
    } catch (error) {
      return Err({ type: 'network', error });
    }
  }

  private url(route: string): string {
    return `${this.instance.baseUrl.replace(/\/$/, '')}${route}`;
  }
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
