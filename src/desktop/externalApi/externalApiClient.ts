import { Err, Ok, Result } from 'ts-results-es';
import { z } from 'zod';

import {
  dashboardDocumentRoute,
  DashboardItem,
  dashboardItemRoute,
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
  storyboardDocumentRoute,
  StoryboardItem,
  storyboardItemRoute,
  storyboardItemSchema,
  StoryboardList,
  storyboardListSchema,
  SummaryData,
  summaryDataSchema,
  ValidationResult,
  validationResultSchema,
  WorkbookInventory,
  workbookInventorySchema,
  worksheetDocumentRoute,
  WorksheetItem,
  worksheetItemRoute,
  worksheetItemSchema,
  WorksheetList,
  worksheetListSchema,
  worksheetSummaryDataRoute,
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

/** Query options for `GET /v0/workbook/worksheets/{id}/summaryData`. */
export type SummaryDataOptions = {
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
    return this.getDocument(EXTERNAL_API_ROUTES.workbookDocument, signal);
  }

  async listWorksheets(signal?: AbortSignal): Promise<Result<WorksheetList, ExternalApiError>> {
    return this.getDecoded(EXTERNAL_API_ROUTES.worksheets, worksheetListSchema, signal);
  }

  async getWorksheetDocument(
    id: string,
    signal?: AbortSignal,
  ): Promise<Result<WorkbookDocument, ExternalApiError>> {
    return this.getDocument(worksheetDocumentRoute(id), signal);
  }

  async getWorksheetSummaryData(
    id: string,
    options: SummaryDataOptions = {},
    signal?: AbortSignal,
  ): Promise<Result<SummaryData, ExternalApiError>> {
    const route = appendQuery(worksheetSummaryDataRoute(id), {
      maxRows: options.maxRows,
      ignoreAliases: options.ignoreAliases,
      ignoreSelection: options.ignoreSelection,
      columnsToIncludeByFieldName: options.columnsToIncludeByFieldName,
    });
    return this.getDecoded(route, summaryDataSchema, signal);
  }

  async listDashboards(signal?: AbortSignal): Promise<Result<DashboardList, ExternalApiError>> {
    return this.getDecoded(EXTERNAL_API_ROUTES.dashboards, dashboardListSchema, signal);
  }

  async getDashboardDocument(
    id: string,
    signal?: AbortSignal,
  ): Promise<Result<WorkbookDocument, ExternalApiError>> {
    return this.getDocument(dashboardDocumentRoute(id), signal);
  }

  async getWorksheet(
    id: string,
    signal?: AbortSignal,
  ): Promise<Result<WorksheetItem, ExternalApiError>> {
    return this.getDecoded(worksheetItemRoute(id), worksheetItemSchema, signal);
  }

  async getDashboard(
    id: string,
    signal?: AbortSignal,
  ): Promise<Result<DashboardItem, ExternalApiError>> {
    return this.getDecoded(dashboardItemRoute(id), dashboardItemSchema, signal);
  }

  async listStoryboards(signal?: AbortSignal): Promise<Result<StoryboardList, ExternalApiError>> {
    return this.getDecoded(EXTERNAL_API_ROUTES.storyboards, storyboardListSchema, signal);
  }

  async getStoryboard(
    id: string,
    signal?: AbortSignal,
  ): Promise<Result<StoryboardItem, ExternalApiError>> {
    return this.getDecoded(storyboardItemRoute(id), storyboardItemSchema, signal);
  }

  async getStoryboardDocument(
    id: string,
    signal?: AbortSignal,
  ): Promise<Result<WorkbookDocument, ExternalApiError>> {
    return this.getDocument(storyboardDocumentRoute(id), signal);
  }

  async getWorkbookInventory(
    signal?: AbortSignal,
  ): Promise<Result<WorkbookInventory, ExternalApiError>> {
    return this.getDecoded(EXTERNAL_API_ROUTES.workbook, workbookInventorySchema, signal);
  }

  async listWorkbookDatasources(
    signal?: AbortSignal,
  ): Promise<Result<DatasourceList, ExternalApiError>> {
    return this.getDecoded(EXTERNAL_API_ROUTES.workbookDatasources, datasourceListSchema, signal);
  }

  async getSite(signal?: AbortSignal): Promise<Result<Site, ExternalApiError>> {
    return this.getDecoded(EXTERNAL_API_ROUTES.site, siteSchema, signal);
  }

  async listSiteDatasources(
    signal?: AbortSignal,
  ): Promise<Result<SiteDatasourceList, ExternalApiError>> {
    return this.getDecoded(EXTERNAL_API_ROUTES.siteDatasources, siteDatasourceListSchema, signal);
  }

  async listSiteWorkbooks(
    signal?: AbortSignal,
  ): Promise<Result<SiteWorkbookList, ExternalApiError>> {
    return this.getDecoded(EXTERNAL_API_ROUTES.siteWorkbooks, siteWorkbookListSchema, signal);
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
    const parsed = validationResultSchema.safeParse(json);
    if (!parsed.success) {
      return Err({ type: 'invalid-response', error: parsed.error });
    }
    return Ok(parsed.data);
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

  /** GET an XML document route, surfacing the `x-tableau-*` version headers. */
  private async getDocument(
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

  /** GET a JSON route and validate it against `schema`. */
  private async getDecoded<T>(
    route: string,
    schema: z.ZodType<T>,
    signal?: AbortSignal,
  ): Promise<Result<T, ExternalApiError>> {
    const response = await this.request('GET', route, { signal });
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

  private async parseEnvelope(
    response: Result<Response, ExternalApiError>,
  ): Promise<Result<OperationEnvelope, ExternalApiError>> {
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

    const parsed = operationEnvelopeSchema.safeParse(json);
    if (!parsed.success) {
      return Err({ type: 'invalid-response', error: parsed.error });
    }
    return Ok(parsed.data);
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

function appendQuery(
  route: string,
  params: Record<string, string | number | boolean | undefined>,
): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) {
      query.set(key, String(value));
    }
  }
  const qs = query.toString();
  return qs ? `${route}?${qs}` : route;
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
