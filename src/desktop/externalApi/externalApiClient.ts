import { Err, Ok, Result } from 'ts-results-es';

import {
  EXTERNAL_API_ROUTES,
  ExternalApiError,
  ExternalApiInstance,
  HEADER_APPLICATION_VERSION,
  HEADER_XSD_PAYLOAD_VERSION,
  OperationEnvelope,
  operationEnvelopeSchema,
  problemResponseSchema,
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
    const response = await this.request('GET', EXTERNAL_API_ROUTES.workbookDocument, { signal });
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
