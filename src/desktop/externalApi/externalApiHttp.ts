import { Err, Ok, Result } from 'ts-results-es';
import { z } from 'zod';

import type { WorkbookDocument } from './executorTypes.js';
import {
  ExternalApiError,
  ExternalApiInstance,
  HEADER_APPLICATION_VERSION,
  HEADER_XSD_PAYLOAD_VERSION,
  OperationEnvelope,
  operationEnvelopeSchema,
  problemResponseSchema,
} from './types.js';

export type ExternalApiHttpOptions = {
  /** Injectable fetch — defaults to the global. Tests pass real HTTP to a mock server. */
  fetchFn?: typeof fetch;
  /** Global ceiling for each request; a per-call override can shorten it, never extend it. */
  timeoutMs?: number;
  /** Overall wall-clock ceiling for a 202→poll loop, separate from the per-fetch timeout. */
  pollDeadlineMs?: number;
};

export type ExternalApiRequestOptions = {
  /** Per-call ceiling, applied beneath the configured global (e.g. a short liveness budget). */
  timeoutMs?: number;
};

const DEFAULT_TIMEOUT_MS = 60_000;

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

// A document read polled to terminal carries its XML under `result.document` (a JSON string),
// since the poll endpoint always returns the JSON Operation envelope, never a raw-XML body.
const documentResultSchema = z.object({ document: z.string() }).passthrough();

// A polled read can settle FAILED (e.g. a Desktop-side serialization error), which carries no
// `result`. Surface the operation's own error so callers see Desktop's message instead of a
// schema-parse failure on the absent payload. On success the `result` object is returned.
function terminalReadResult(
  envelope: OperationEnvelope,
): Result<Record<string, unknown>, ExternalApiError> {
  if (envelope.error !== undefined || envelope.state?.toUpperCase() !== 'SUCCEEDED') {
    return Err({
      type: 'problem',
      status: 500,
      code: envelope.error?.code ?? 'operation-failed',
      detail: envelope.error?.message ?? `Read operation ${envelope.kind} did not succeed.`,
    });
  }
  return Ok(envelope.result ?? {});
}

/**
 * Generic HTTP layer for a single Tableau Desktop External Client API instance.
 *
 * Bound to one {@link ExternalApiInstance} (baseUrl + token). Pure transport with no
 * endpoint knowledge: callers supply a route (see `EXTERNAL_API_ROUTES` and the route
 * builders in types.ts) plus the response shape they expect. The Bearer token is attached
 * to every request and Problem responses are surfaced as typed {@link ExternalApiError}s
 * (401 → `unauthorized`, so callers can rescan). A 202 is polled via its `Location`
 * header to a terminal Operation.
 */
export class ExternalApiHttp {
  private readonly instance: ExternalApiInstance;
  private readonly fetchFn: typeof fetch;
  private readonly timeoutMs: number | undefined;
  private readonly pollDeadlineMs: number;

  constructor(instance: ExternalApiInstance, options: ExternalApiHttpOptions = {}) {
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

  /** GET that reports only transport-level success (`res.ok`) — an error body is never mapped. */
  async getOk(
    route: string,
    signal?: AbortSignal,
    options?: ExternalApiRequestOptions,
  ): Promise<Result<{ ok: boolean }, ExternalApiError>> {
    const response = await this.request('GET', route, { signal, timeoutMs: options?.timeoutMs });
    if (response.isErr()) {
      return Err(response.error);
    }
    return Ok({ ok: response.value.ok });
  }

  /** GET returning a schema-validated JSON body; a 202 overflow is polled to its terminal result. */
  async getJson<T extends z.ZodTypeAny>(
    route: string,
    schema: T,
    signal?: AbortSignal,
    options?: ExternalApiRequestOptions,
  ): Promise<Result<z.infer<T>, ExternalApiError>> {
    const response = await this.request('GET', route, { signal, timeoutMs: options?.timeoutMs });
    return this.parseJson(response, schema, signal);
  }

  /** GET returning a raw-XML document body plus its version headers; a 202 overflow is polled. */
  async getXml(
    route: string,
    signal?: AbortSignal,
    options?: ExternalApiRequestOptions,
  ): Promise<Result<WorkbookDocument, ExternalApiError>> {
    const response = await this.request('GET', route, { signal, timeoutMs: options?.timeoutMs });
    if (response.isErr()) {
      return Err(response.error);
    }

    const res = response.value;
    if (res.status === HTTP_ACCEPTED) {
      const operation = await this.pollOperation(res, signal);
      if (operation.isErr()) {
        return Err(operation.error);
      }
      const settled = terminalReadResult(operation.value);
      if (settled.isErr()) {
        return Err(settled.error);
      }
      const parsed = documentResultSchema.safeParse(settled.value);
      if (!parsed.success) {
        return Err({ type: 'invalid-response', error: parsed.error });
      }
      return Ok({
        xml: parsed.data.document,
        applicationVersion: res.headers.get(HEADER_APPLICATION_VERSION) ?? undefined,
        // The XSD-payload-version header is sync-only; the poll response does not carry it.
        xsdPayloadVersion: undefined,
      });
    }
    const pending = await pendingOverflowError(res);
    if (pending) {
      return Err(pending);
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

  /** POST of an XML body expecting an Operation envelope back (a 202 is polled to terminal). */
  async postXmlEnvelope(
    route: string,
    xml: string,
    signal?: AbortSignal,
    options?: ExternalApiRequestOptions,
  ): Promise<Result<OperationEnvelope, ExternalApiError>> {
    const response = await this.request('POST', route, {
      signal,
      contentType: 'application/xml',
      body: xml,
      timeoutMs: options?.timeoutMs,
    });
    return this.parseEnvelope(response, signal);
  }

  /** POST of a JSON body expecting an Operation envelope back (a 202 is polled to terminal). */
  async postJsonEnvelope(
    route: string,
    body: unknown,
    signal?: AbortSignal,
    options?: ExternalApiRequestOptions,
  ): Promise<Result<OperationEnvelope, ExternalApiError>> {
    const response = await this.request('POST', route, {
      signal,
      contentType: 'application/json',
      body: JSON.stringify(body),
      timeoutMs: options?.timeoutMs,
    });
    return this.parseEnvelope(response, signal);
  }

  /** Bodyless POST expecting an Operation envelope back (a 202 is polled to terminal). */
  async postEnvelope(
    route: string,
    signal?: AbortSignal,
    options?: ExternalApiRequestOptions,
  ): Promise<Result<OperationEnvelope, ExternalApiError>> {
    const response = await this.request('POST', route, { signal, timeoutMs: options?.timeoutMs });
    return this.parseEnvelope(response, signal);
  }

  /** POST of an XML body whose response is a schema-validated JSON body, not an operation. */
  async postXmlForBody<T extends z.ZodTypeAny>(
    route: string,
    xml: string,
    schema: T,
    signal?: AbortSignal,
    options?: ExternalApiRequestOptions,
  ): Promise<Result<z.infer<T>, ExternalApiError>> {
    const response = await this.request('POST', route, {
      signal,
      contentType: 'application/xml',
      body: xml,
      timeoutMs: options?.timeoutMs,
    });
    return this.parseJson(response, schema, signal);
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

  private async parseJson<T extends z.ZodTypeAny>(
    response: Result<Response, ExternalApiError>,
    schema: T,
    signal?: AbortSignal,
  ): Promise<Result<z.infer<T>, ExternalApiError>> {
    if (response.isErr()) {
      return Err(response.error);
    }

    const res = response.value;
    // On overflow (202) the terminal Operation's `result` carries the same body the in-window
    // 200 would have, so poll and read from there. (A 503 precursor overflow is a retry signal,
    // not a pollable operation.)
    if (res.status === HTTP_ACCEPTED) {
      const operation = await this.pollOperation(res, signal);
      if (operation.isErr()) {
        return Err(operation.error);
      }
      const settled = terminalReadResult(operation.value);
      if (settled.isErr()) {
        return Err(settled.error);
      }
      return parseAgainstSchema(settled.value, schema);
    }
    const pending = await pendingOverflowError(res);
    if (pending) {
      return Err(pending);
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

    return parseAgainstSchema(json, schema);
  }

  private async request(
    method: 'GET' | 'POST',
    route: string,
    options: { signal?: AbortSignal; contentType?: string; body?: string; timeoutMs?: number },
  ): Promise<Result<Response, ExternalApiError>> {
    const headers: Record<string, string> = {
      authorization: `Bearer ${this.instance.token}`,
    };
    if (options.contentType) {
      headers['content-type'] = options.contentType;
    }

    // A caller signal is a cancellation channel, not a clock — compose, never replace. `??` here
    // meant the default timeout never applied, because every desktop tool passes extra.signal.
    const signal = composeWithTimeout(options.signal, this.effectiveTimeoutMs(options.timeoutMs));

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

  // A per-call budget only tightens the global ceiling — a caller can never extend it.
  private effectiveTimeoutMs(overrideMs: number | undefined): number {
    const globalTimeoutMs = this.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    return overrideMs !== undefined ? Math.min(globalTimeoutMs, overrideMs) : globalTimeoutMs;
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

// A 503 whose Problem code is `operation-pending` means an internal precursor (e.g. summaryData's
// {id} resolution) overflowed and there is no operation to poll — retry the whole request. Any
// other 503 (api-disabled, shutting-down) is left to mapErrorResponse to keep its real code.
async function pendingOverflowError(res: Response): Promise<ExternalApiError | undefined> {
  if (res.status === HTTP_SERVICE_UNAVAILABLE && (await problemCode(res)) === 'operation-pending') {
    const seconds = Number.parseInt(res.headers.get(HEADER_RETRY_AFTER) ?? '', 10);
    return {
      type: 'operation-pending',
      retryAfterSeconds: Number.isFinite(seconds) ? seconds : undefined,
    };
  }
  return undefined;
}

function parseAgainstSchema<T extends z.ZodTypeAny>(
  value: unknown,
  schema: T,
): Result<z.infer<T>, ExternalApiError> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    return Err({ type: 'invalid-response', error: parsed.error });
  }
  return Ok(parsed.data);
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
