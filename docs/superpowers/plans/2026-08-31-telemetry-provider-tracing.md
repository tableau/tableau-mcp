# TelemetryProvider Tracing Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `startSpan`/`SpanHandle` distributed-tracing primitive to tableau-mcp's published `TelemetryProvider` interface, and wire span coverage into every outbound-call boundary the design identified — the main REST API's axios interceptors, the tool-call parent span, OAuth token exchange/signout/redirect/metadata-fetch, the product telemetry forwarder, and S3 staged upload.

**Architecture:** One new optional interface method (`startSpan?`) plus a `SpanHandle` type, added to the existing dependency-free `telemetryProvider.ts` contract. `NoOpTelemetryProvider` implements it as a trivial no-op. `validateTelemetryProvider` is fixed to check a hardcoded list of required methods (instead of reflecting on `NoOpTelemetryProvider`'s prototype) so `startSpan` stays genuinely optional for existing external custom providers. Every call site uses one of two patterns: a single-call-site "start before, end in `finally`" pattern for one-shot async calls, or a `WeakMap`-correlated "start in the request interceptor, end in the matching response/error interceptor" pattern for the REST API's independently-invoked axios interceptor callbacks.

**Tech Stack:** TypeScript, Vitest, axios/Zodios, `ts-results-es` (`Result`/`Ok`/`Err`), `jose` (JWE), Node native `crypto`.

**Spec:** `docs/superpowers/specs/2026-08-31-telemetry-provider-tracing-design.md`

## Global Constraints

- The published `TelemetryProvider` interface (`src/telemetry/telemetryProvider.ts`) must stay free of runtime dependencies (no OpenTelemetry types) — the file's own header comment already states this.
- `startSpan` is optional at both the type level (`?`) and the runtime-validation level (`validateTelemetryProvider`'s required-methods list is `['initialize', 'recordMetric', 'recordHistogram']` — fixed, not derived from `NoOpTelemetryProvider`'s prototype). Existing external custom providers that predate this change must keep validating successfully.
- Every call site that starts a span must feature-detect it (`provider.startSpan?.(...)`) and must not throw when the concrete provider has no `startSpan`.
- Single-call-site pattern (Tasks 3–8), applied verbatim at every one-shot async boundary:
  ```ts
  const span = getTelemetryProvider().startSpan?.('span.name', { attrs });
  let error: unknown;
  try {
    return await someCall();
  } catch (caughtError) {
    error = caughtError;
    throw caughtError;
  } finally {
    span?.end(error);
  }
  ```
  Use a variable name other than the pattern's own `error` when the surrounding function already has a `catch (error)` binding in scope, to avoid shadowing (see Task 3 and Task 5).
- Out of scope (do not touch): `src/desktop/getAgentApiClient.ts` (Desktop Agent API client), `MonCloudTelemetryProvider` (a separate repo, tabhf-mcp-svc).
- Per this repo's testing convention, extend each call site's *existing* test suite rather than adding new parallel test files, except where no test file exists yet for that source file (Tasks 4, 5, 6, 8 create new test files because none exist today).
- Run `npx vitest run <file>` (never bare `vitest`, which is watch mode and hangs) after every implementation step.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/telemetry/telemetryProvider.ts` | Adds `SpanHandle` + `startSpan?` to the published interface (Task 1) |
| `src/telemetry/noop.ts` | No-op `startSpan()` implementation (Task 1) |
| `src/telemetry/init.ts` | Fixes `validateTelemetryProvider`'s required-methods list; exports it (Task 1) |
| `src/telemetry/noop.test.ts` | New — covers the no-op `startSpan()` (Task 1) |
| `src/telemetry/init.test.ts` | Extended — direct unit tests of the now-exported `validateTelemetryProvider` (Task 1) |
| `src/sdks/interceptors.ts` | Adds `rawConfig` field to both interceptor config types (Task 2) |
| `src/sdks/tableau/restApi.ts` | Populates `rawConfig` in `_addInterceptors` (Task 2) |
| `src/restApiInstance.ts` | `WeakMap`-correlated span start/end across all 4 interceptor factories (Task 2) |
| `src/restApiInstance.test.ts` | Extended — span assertions for the 4 interceptor factories (Task 2) |
| `src/tools/web/tool.ts` | Tool-call parent span in `WebTool.logAndExecute` (Task 3) |
| `src/tools/web/tool.test.ts` | Extended — span assertions for `logAndExecute` (Task 3) |
| `src/sdks/tableau-oauth/methods.ts` | Span around the OAuth token-exchange call (Task 4) |
| `src/sdks/tableau-oauth/methods.test.ts` | New (Task 4) |
| `src/server/oauth/revoke.ts` | Span around the upstream Tableau signout `fetch()`; exports `tryRevokeAccessToken` (Task 5) |
| `src/server/oauth/revoke.test.ts` | New (Task 5) |
| `src/server/oauth/authorize.ts` | Spans around the site-picker redirect `fetch()` and the client-metadata-doc axios call; exports both functions (Task 6) |
| `src/server/oauth/authorize.test.ts` | New (Task 6) |
| `src/telemetry/productTelemetry/telemetryForwarder.ts` | Span around `sendTelemetryRequest`'s `fetch()` (Task 7) |
| `src/telemetry/productTelemetry/telemetryForwarder.test.ts` | Extended (Task 7) |
| `src/tools/web/s3Client.ts` | Spans around `uploadBufferToS3`'s and `downloadObjectFromS3`'s `client.send(...)` calls (Task 8) |
| `src/tools/web/s3Client.test.ts` | New (Task 8) |

**Dependency graph:** Task 1 must land first (every other task imports `SpanHandle` / calls `startSpan?`). Tasks 2–8 touch disjoint files and can be parallelized across separate git worktrees once Task 1 is merged.

---

### Task 1: Foundation — `SpanHandle` primitive + backward-compatible validation

**Files:**
- Modify: `src/telemetry/telemetryProvider.ts` (add `SpanHandle` interface + `startSpan?`)
- Modify: `src/telemetry/noop.ts` (implement `startSpan()`)
- Modify: `src/telemetry/init.ts:12-19,28-40` (delete `getInstanceMethods`, fix + export `validateTelemetryProvider`)
- Test: `src/telemetry/noop.test.ts` (create)
- Test: `src/telemetry/init.test.ts` (extend)

**Interfaces:**
- Consumes: nothing (this is the foundation task).
- Produces:
  - `export interface SpanHandle { end(error?: unknown): void; }` — imported by every other task as `import type { SpanHandle } from '../telemetry/telemetryProvider.js';` (path relative to the importing file).
  - `TelemetryProvider.startSpan?(name: string, attributes?: TelemetryAttributes): SpanHandle` — called by every other task as `getTelemetryProvider().startSpan?.(name, attributes)`.
  - `export function validateTelemetryProvider(provider: unknown): asserts provider is TelemetryProvider` from `src/telemetry/init.ts` (newly exported; used only by this task's own tests).

- [ ] **Step 1: Add `SpanHandle` and `startSpan?` to the published interface**

Edit `src/telemetry/telemetryProvider.ts`:

```ts
/**
 * Public, dependency-free provider contract for telemetry.
 *
 * This module is exposed as a package subpath (`@tableau/mcp-server/telemetry/telemetryProvider`)
 * so external deployments can implement a custom telemetry provider against a stable type,
 * without importing the server's internal config schemas or zod. Keep it free of runtime dependencies.
 *
 * `TelemetryAttributes` is hand-written here to avoid runtime dependencies.
 */

/**
 * Attributes/dimensions attached to a telemetry metric.
 * Values can be strings, numbers, booleans, or undefined.
 */
export type TelemetryAttributes = Record<string, string | number | boolean | undefined>;

/**
 * Handle to an in-flight span, returned by {@link TelemetryProvider.startSpan}.
 */
export interface SpanHandle {
  /**
   * Ends the span. Pass the error if the operation failed.
   */
  end(error?: unknown): void;
}

/**
 * Telemetry provider interface for metrics collection.
 */
export interface TelemetryProvider {
  /**
   * Initialize the telemetry provider.
   */
  initialize(): void;

  /**
   * Record a custom metric with the given name and attributes.
   *
   * @param name - The metric name (e.g., 'apm_mcp_tool_calls')
   * @param value - The metric value (default: 1 for counters)
   * @param attributes - Dimensions/tags for the metric
   *
   * @example
   * ```typescript
   * telemetry.recordMetric('apm_mcp_tool_calls', 1, {
   *   tool_name: 'list-pulse-metric-subscriptions',
   * });
   * ```
   */
  recordMetric(name: string, value: number, attributes: TelemetryAttributes): void;

  /**
   * Record a histogram observation (e.g., latency) with the given name and attributes.
   *
   * @param name - The metric name (e.g., 'http_server_request_duration')
   * @param value - The observed value (e.g., duration in milliseconds)
   * @param attributes - Dimensions/tags for the metric
   *
   * @example
   * ```typescript
   * telemetry.recordHistogram('apm_mcp_tool_duration', 142.5, {
   *   tool_name: 'get-datasource-metadata',
   *   success: true,
   * });
   * ```
   */
  recordHistogram(name: string, value: number, attributes: TelemetryAttributes): void;

  /**
   * Starts a span and returns a handle to end it later. Optional: providers that
   * don't implement tracing simply don't have this method, and call sites must
   * feature-detect it (`provider.startSpan?.(...)`).
   *
   * @param name - The span name (e.g., 'tableau.rest_api.request')
   * @param attributes - Dimensions/tags for the span
   */
  startSpan?(name: string, attributes?: TelemetryAttributes): SpanHandle;
}
```

- [ ] **Step 2: Write the failing `noop.test.ts`**

Create `src/telemetry/noop.test.ts`:

```ts
import { NoOpTelemetryProvider } from './noop.js';

describe('NoOpTelemetryProvider', () => {
  it('initialize is a no-op', () => {
    const provider = new NoOpTelemetryProvider();
    expect(() => provider.initialize()).not.toThrow();
  });

  it('recordMetric is a no-op', () => {
    const provider = new NoOpTelemetryProvider();
    expect(() => provider.recordMetric('metric', 1, {})).not.toThrow();
  });

  it('recordHistogram is a no-op', () => {
    const provider = new NoOpTelemetryProvider();
    expect(() => provider.recordHistogram('metric', 1, {})).not.toThrow();
  });

  it('startSpan returns a handle whose end() is a no-op', () => {
    const provider = new NoOpTelemetryProvider();
    const span = provider.startSpan();
    expect(() => span.end()).not.toThrow();
    expect(() => span.end(new Error('boom'))).not.toThrow();
  });
});
```

- [ ] **Step 3: Run it to confirm it fails**

Run: `npx vitest run src/telemetry/noop.test.ts`
Expected: FAIL — `provider.startSpan is not a function`.

- [ ] **Step 4: Implement `startSpan` on `NoOpTelemetryProvider`**

Edit `src/telemetry/noop.ts`:

```ts
/**
 * NoOp telemetry provider - does nothing.
 * This is the default provider when telemetry is disabled.
 *
 * Zero overhead implementation that can be safely used in production
 * when telemetry is not needed.
 */

import type { SpanHandle, TelemetryAttributes, TelemetryProvider } from './telemetryProvider.js';

export class NoOpTelemetryProvider implements TelemetryProvider {
  initialize(): void {
    // No-op
  }

  recordMetric(_name: string, _value: number, _attributes: TelemetryAttributes): void {
    // No-op
  }

  recordHistogram(_name: string, _value: number, _attributes: TelemetryAttributes): void {
    // No-op
  }

  startSpan(): SpanHandle {
    return { end: () => {} };
  }
}
```

- [ ] **Step 5: Run it to confirm it passes**

Run: `npx vitest run src/telemetry/noop.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Write the failing `validateTelemetryProvider` tests**

Add to `src/telemetry/init.test.ts` (extend the existing import line and add a new `describe` block):

```ts
import { stubDefaultEnvVars } from '../testShared.js';
import { initializeTelemetry, validateTelemetryProvider } from './init.js';
const mocks = vi.hoisted(() => ({
  MockNoOpTelemetryProvider: vi.fn(),
}));

vi.mock('./noop.js', () => ({
  NoOpTelemetryProvider: mocks.MockNoOpTelemetryProvider,
}));

describe('initializeTelemetry', () => {
  // ... existing tests unchanged ...
});

describe('validateTelemetryProvider', () => {
  it('accepts a provider missing startSpan (backward compatibility)', () => {
    const provider = {
      initialize: () => {},
      recordMetric: () => {},
      recordHistogram: () => {},
    };

    expect(() => validateTelemetryProvider(provider)).not.toThrow();
  });

  it('accepts a provider that also implements startSpan', () => {
    const provider = {
      initialize: () => {},
      recordMetric: () => {},
      recordHistogram: () => {},
      startSpan: () => ({ end: () => {} }),
    };

    expect(() => validateTelemetryProvider(provider)).not.toThrow();
  });

  it('throws when a required method is missing', () => {
    const provider = {
      initialize: () => {},
      recordHistogram: () => {},
    };

    expect(() => validateTelemetryProvider(provider)).toThrowError(
      'Custom provider missing required methods: recordMetric',
    );
  });

  it('throws when the provider is not an object', () => {
    expect(() => validateTelemetryProvider('not-an-object')).toThrowError(
      'Provider must be an object',
    );
  });
});
```

- [ ] **Step 7: Run it to confirm it fails**

Run: `npx vitest run src/telemetry/init.test.ts`
Expected: FAIL — `validateTelemetryProvider` is not exported from `./init.js`.

- [ ] **Step 8: Export `validateTelemetryProvider`, fix its required-methods list, delete `getInstanceMethods`**

Edit `src/telemetry/init.ts`. Delete the `getInstanceMethods` function (current lines 12-19):

```ts
/**
 * Get all instance methods from a class prototype
 */
function getInstanceMethods(cls: new (...args: unknown[]) => unknown): string[] {
  return Object.getOwnPropertyNames(cls.prototype).filter(
    (name) => name !== 'constructor' && typeof cls.prototype[name] === 'function',
  );
}
```

Replace `validateTelemetryProvider` (current lines 25-40):

```ts
/**
 * Validate that a provider implements all required TelemetryProvider methods.
 *
 * The required-methods list is a fixed, explicit list rather than derived from
 * NoOpTelemetryProvider's prototype, so adding an optional method (e.g. startSpan)
 * to NoOpTelemetryProvider never silently makes that method required for existing
 * external custom providers.
 */
export function validateTelemetryProvider(provider: unknown): asserts provider is TelemetryProvider {
  if (!isRecord(provider)) {
    throw new Error('Provider must be an object');
  }

  const requiredMethods = ['initialize', 'recordMetric', 'recordHistogram'] as const;
  const missingMethods = requiredMethods.filter((method) => typeof provider[method] !== 'function');

  if (missingMethods.length > 0) {
    throw new Error(`Custom provider missing required methods: ${missingMethods.join(', ')}`);
  }
}
```

Note: `NoOpTelemetryProvider` is still imported and used elsewhere in this file (`new NoOpTelemetryProvider()` in `initializeTelemetry`), so its import stays — only the `getInstanceMethods` helper is deleted.

- [ ] **Step 9: Run it to confirm it passes**

Run: `npx vitest run src/telemetry/init.test.ts`
Expected: PASS (existing `initializeTelemetry` tests + 4 new `validateTelemetryProvider` tests).

- [ ] **Step 10: Run the full suite to check for regressions, then commit**

Run: `npx vitest run`
Expected: PASS, no regressions elsewhere.

```bash
git add src/telemetry/telemetryProvider.ts src/telemetry/noop.ts src/telemetry/noop.test.ts src/telemetry/init.ts src/telemetry/init.test.ts
git commit -m "feat: add startSpan/SpanHandle tracing primitive to TelemetryProvider"
```

---

### Task 2: REST API axios interceptor spans (`restApiInstance.ts`)

**Depends on:** Task 1 (`SpanHandle`, `startSpan?`).

**Files:**
- Modify: `src/sdks/interceptors.ts` (add `rawConfig` field to both config types)
- Modify: `src/sdks/tableau/restApi.ts:340-368` (populate `rawConfig` in `_addInterceptors`)
- Modify: `src/restApiInstance.ts` (span start/end across all 4 interceptor factories)
- Test: `src/restApiInstance.test.ts` (extend)

**Interfaces:**
- Consumes: `SpanHandle` from `../telemetry/telemetryProvider.js`; `getTelemetryProvider` from `./telemetry/init.js`.
- Produces: nothing consumed by later tasks — this task covers VizQL Data Service and Metadata API "for free" since they share the same `RestApi`/Zodios interceptor registration; no separate task touches them.

**Design note:** axios preserves the same request-config object reference through `response.config` and `error.config`. The request interceptor's *success* callback and the response/error interceptors don't receive that raw object today — they receive freshly-constructed wrapper objects (`RequestInterceptorConfig`/`ResponseInterceptorConfig`). Adding an optional `rawConfig` field to those wrapper types (populated once, in `restApi.ts`) lets `restApiInstance.ts` correlate a request's span across the two independently-invoked callbacks via a `WeakMap<object, SpanHandle>` keyed on that raw config reference — no explicit cleanup needed, since a `WeakMap` entry is garbage-collection-eligible once nothing else references the config object. The error-path interceptors already receive the raw axios error object directly (`error.config` is the same reference), so they read it directly rather than through a wrapper.

- [ ] **Step 1: Write the failing span tests**

Add to `src/restApiInstance.test.ts`. First, add the mock and import (near the top, after the existing `vi.mock` calls):

```ts
import { getTelemetryProvider } from './telemetry/init.js';

vi.mock('./telemetry/init.js', () => ({
  getTelemetryProvider: vi.fn(),
}));
```

Then extend the existing `it('should add User-Agent header and log request', ...)` test in `describe('Request Interceptor', ...)` with one added assertion (no other changes to that test):

```ts
      expect(getTelemetryProvider).not.toHaveBeenCalled();
```

And extend the existing `it('should log response', ...)` test in `describe('Response Interceptor', ...)` the same way:

```ts
      expect(getTelemetryProvider).not.toHaveBeenCalled();
```

These two additions assert the backward-compat fallback: a `mockRequest`/`mockResponse` with no `rawConfig` field (as both existing tests already construct) never touches telemetry at all.

Then add a new `describe` block at the end of the file, inside the outer `describe('restApiInstance', ...)`, after `describe('LUID Context Integration', ...)`:

```ts
  describe('Span tracing', () => {
    it('starts a span on request and ends it on response using the shared rawConfig identity', () => {
      const mockSpan = { end: vi.fn() };
      const mockProvider = {
        initialize: vi.fn(),
        recordMetric: vi.fn(),
        recordHistogram: vi.fn(),
        startSpan: vi.fn().mockReturnValue(mockSpan),
      };
      vi.mocked(getTelemetryProvider).mockReturnValue(mockProvider);

      const server = new WebMcpServer();
      const rawConfig = { method: 'GET', url: '/api/test', headers: {} };

      const requestInterceptor = getRequestInterceptor(server, mockRequestId);
      requestInterceptor({
        headers: {} as Record<string, string>,
        method: 'GET',
        url: '/api/test',
        baseUrl: mockHost,
        rawConfig,
      });

      expect(mockProvider.startSpan).toHaveBeenCalledWith('tableau.rest_api.request', {
        method: 'GET',
        url: '/api/test',
      });
      expect(mockSpan.end).not.toHaveBeenCalled();

      const responseInterceptor = getResponseInterceptor(server, mockRequestId);
      responseInterceptor({
        status: 200,
        url: '/api/test',
        baseUrl: mockHost,
        params: {},
        headers: {},
        data: {},
        rawConfig,
      });

      expect(mockSpan.end).toHaveBeenCalledWith();
    });

    it('does not throw when the provider has no startSpan (feature-detection fallback)', () => {
      vi.mocked(getTelemetryProvider).mockReturnValue({
        initialize: vi.fn(),
        recordMetric: vi.fn(),
        recordHistogram: vi.fn(),
      });

      const server = new WebMcpServer();
      const rawConfig = { method: 'GET', url: '/api/test', headers: {} };

      const requestInterceptor = getRequestInterceptor(server, mockRequestId);
      expect(() =>
        requestInterceptor({
          headers: {} as Record<string, string>,
          method: 'GET',
          url: '/api/test',
          baseUrl: mockHost,
          rawConfig,
        }),
      ).not.toThrow();
    });

    it('ends the span with the error via error.config on a request error', () => {
      const mockSpan = { end: vi.fn() };
      const mockProvider = {
        initialize: vi.fn(),
        recordMetric: vi.fn(),
        recordHistogram: vi.fn(),
        startSpan: vi.fn().mockReturnValue(mockSpan),
      };
      vi.mocked(getTelemetryProvider).mockReturnValue(mockProvider);

      const server = new WebMcpServer();
      const rawConfig = { method: 'GET', url: '/api/test', headers: {} };

      getRequestInterceptor(server, mockRequestId)({
        headers: {} as Record<string, string>,
        method: 'GET',
        url: '/api/test',
        baseUrl: mockHost,
        rawConfig,
      });

      const mockError = {
        isAxiosError: true,
        config: rawConfig,
        request: {
          method: 'GET',
          url: '/api/test',
          baseUrl: mockHost,
          headers: {},
        },
      };

      getRequestErrorInterceptor(server, mockRequestId)(mockError, mockHost);

      expect(mockSpan.end).toHaveBeenCalledWith(mockError);
    });

    it('ends the span with the error via error.config on a response error', () => {
      const mockSpan = { end: vi.fn() };
      const mockProvider = {
        initialize: vi.fn(),
        recordMetric: vi.fn(),
        recordHistogram: vi.fn(),
        startSpan: vi.fn().mockReturnValue(mockSpan),
      };
      vi.mocked(getTelemetryProvider).mockReturnValue(mockProvider);

      const server = new WebMcpServer();
      const rawConfig = { method: 'GET', url: '/api/test', headers: {} };

      getRequestInterceptor(server, mockRequestId)({
        headers: {} as Record<string, string>,
        method: 'GET',
        url: '/api/test',
        baseUrl: mockHost,
        rawConfig,
      });

      const mockError = {
        isAxiosError: true,
        config: rawConfig,
        response: {
          status: 500,
          url: '/api/test',
          baseUrl: mockHost,
          headers: {},
          data: {},
        },
      };

      getResponseErrorInterceptor(server, mockRequestId)(mockError, mockHost);

      expect(mockSpan.end).toHaveBeenCalledWith(mockError);
    });
  });
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run src/restApiInstance.test.ts`
Expected: FAIL — `rawConfig` doesn't exist on the interceptor config types, and no span logic exists yet.

- [ ] **Step 3: Add `rawConfig` to the interceptor config types**

Edit `src/sdks/interceptors.ts`:

```ts
export type RequestInterceptorConfig = {
  baseUrl: string;
  headers: Record<string, any>;
  rawConfig?: AxiosRequestInterceptorConfig;
  // AxiosHeaders is a complex class, overwrite it for simplicity.
} & Omit<AxiosRequestInterceptorConfig, 'headers'>;

export type AxiosResponseInterceptor = Parameters<AxiosInterceptor['response']['use']>[0];
export type AxiosResponseInterceptorConfig = Parameters<NonNullable<AxiosResponseInterceptor>>[0];
export type ResponseInterceptorConfig = {
  baseUrl: string;
  url: string;
  headers: Record<string, any>;
  rawConfig?: AxiosRequestInterceptorConfig;
  // AxiosHeaders is a complex class, overwrite it for simplicity.
} & Omit<AxiosResponseInterceptorConfig, 'headers' | 'statusText' | 'config'> & {
    params: AxiosResponseInterceptorConfig['config']['params'];
  };
```

(Only the two type declarations change; `getRequestInterceptorConfig`/`getResponseInterceptorConfig` are unchanged — `rawConfig` is populated directly in `restApi.ts`, not through these helpers.)

- [ ] **Step 4: Populate `rawConfig` in `restApi.ts`'s `_addInterceptors`**

Edit `src/sdks/tableau/restApi.ts` (current lines 340-368):

```ts
  private _addInterceptors = (baseUrl: string, interceptors: AxiosInterceptor): void => {
    interceptors.request.use(
      (config) => {
        this._requestInterceptor?.[0]({
          baseUrl,
          rawConfig: config,
          ...getRequestInterceptorConfig(config),
        });
        return config;
      },
      (error) => {
        this._requestInterceptor?.[1]?.(error, baseUrl);
        return Promise.reject(error);
      },
    );

    interceptors.response.use(
      (response) => {
        this._responseInterceptor?.[0]({
          baseUrl,
          rawConfig: response.config,
          ...getResponseInterceptorConfig(response),
        });
        return response;
      },
      (error) => {
        this._responseInterceptor?.[1]?.(error, baseUrl);
        return Promise.reject(error);
      },
    );
  };
```

- [ ] **Step 5: Add the `WeakMap` and wire spans into all 4 interceptor factories**

Edit `src/restApiInstance.ts`. Add two imports (alphabetically, between `./server.js` and `./tools/web/toolContext.js`):

```ts
import { getTelemetryProvider } from './telemetry/init.js';
import type { SpanHandle } from './telemetry/telemetryProvider.js';
```

Add the module-level `WeakMap` immediately before `getRequestInterceptor` (current line 213), then replace the 4 interceptor factories:

```ts
const activeRestApiSpans = new WeakMap<object, SpanHandle>();

export const getRequestInterceptor =
  (server: Server, requestId: RequestId): RequestInterceptor =>
  (request) => {
    request.headers['User-Agent'] = server.userAgent;
    logRequest(server, request, requestId);

    if (request.rawConfig) {
      const span = getTelemetryProvider().startSpan?.('tableau.rest_api.request', {
        method: request.method,
        url: request.url,
      });
      if (span) {
        activeRestApiSpans.set(request.rawConfig, span);
      }
    }

    return request;
  };

export const getRequestErrorInterceptor =
  (
    server: Server,
    requestId: RequestId,
    ctx?: { getSiteLuid?: () => string; getUserLuid?: () => string },
  ): ErrorInterceptor =>
  (error, baseUrl) => {
    if (isAxiosError(error) && error.config) {
      activeRestApiSpans.get(error.config)?.end(error);
    }

    if (!isAxiosError(error) || !error.request) {
      log(
        {
          message: `Request ${requestId} failed`,
          level: 'error',
          logger: 'rest-api',
          data: error,
        },
        ctx,
      );
      notifier.error(
        server.mcpServer,
        `Request ${requestId} failed with error: ${getExceptionMessage(error)}`,
        {
          notifier: 'rest-api',
          requestId,
        },
      );
      return;
    }

    const { request } = error;
    logRequest(
      server,
      {
        baseUrl,
        ...getRequestInterceptorConfig(request),
      },
      requestId,
    );
  };

export const getResponseInterceptor =
  (server: Server, requestId: RequestId): ResponseInterceptor =>
  (response) => {
    logResponse(server, response, requestId);

    if (response.rawConfig) {
      activeRestApiSpans.get(response.rawConfig)?.end();
    }

    return response;
  };

export const getResponseErrorInterceptor =
  (
    server: Server,
    requestId: RequestId,
    ctx?: { getSiteLuid?: () => string; getUserLuid?: () => string },
  ): ErrorInterceptor =>
  (error, baseUrl) => {
    if (isAxiosError(error) && error.config) {
      activeRestApiSpans.get(error.config)?.end(error);
    }

    if (!isAxiosError(error) || !error.response) {
      log(
        {
          message: `Response from request ${requestId} failed`,
          level: 'error',
          logger: 'rest-api',
          data: error,
        },
        ctx,
      );
      notifier.error(
        server.mcpServer,
        `Response from request ${requestId} failed with error: ${getExceptionMessage(error)}`,
        { notifier: 'rest-api', requestId },
      );
      return;
    }

    // The type for the AxiosResponse headers is complex and not directly assignable to that of the Axios response interceptor's.
    const { response } = error as { response: AxiosResponseInterceptorConfig };
    logResponse(
      server,
      {
        baseUrl,
        ...getResponseInterceptorConfig(response),
      },
      requestId,
    );
  };
```

`logRequest`/`logResponse` below are unchanged.

- [ ] **Step 6: Run it to confirm it passes**

Run: `npx vitest run src/restApiInstance.test.ts`
Expected: PASS, including all pre-existing tests in this file (`useRestApi`, `Request Interceptor`, `Response Interceptor`, `Error Handling`, `LUID Context Integration`).

- [ ] **Step 7: Run the full suite and build, then commit**

Run: `npx vitest run` and `npm run build:dev`
Expected: PASS.

```bash
git add src/sdks/interceptors.ts src/sdks/tableau/restApi.ts src/restApiInstance.ts src/restApiInstance.test.ts
git commit -m "feat: add span tracing to REST API axios interceptors"
```

---

### Task 3: Tool-call parent span (`tool.ts`)

**Depends on:** Task 1.

**Files:**
- Modify: `src/tools/web/tool.ts:134-260` (`WebTool.logAndExecute`)
- Test: `src/tools/web/tool.test.ts` (extend)

**Interfaces:**
- Consumes: `getTelemetryProvider` (already imported in this file at line 14).
- Produces: nothing consumed by later tasks — this is the outermost span every REST/OAuth/S3 child span (started during a tool callback's execution) nests under, per the spec's "Nesting is automatic" section. No explicit parent-linking code is needed here.

- [ ] **Step 1: Write the failing span tests**

Extend the existing telemetry mock in `src/tools/web/tool.test.ts` (current lines 22-30) to also provide `startSpan`:

```ts
// Mock for MonCloud telemetry - tracks calls to recordMetric() and startSpan()
const mockRecordMetric = vi.hoisted(() => vi.fn());
const mockSpanEnd = vi.hoisted(() => vi.fn());
const mockStartSpan = vi.hoisted(() => vi.fn().mockReturnValue({ end: mockSpanEnd }));
vi.mock('../../telemetry/init.js', () => ({
  getTelemetryProvider: vi.fn().mockReturnValue({
    initialize: vi.fn(),
    recordMetric: mockRecordMetric,
    recordHistogram: vi.fn(),
    startSpan: mockStartSpan,
  }),
}));
```

Add a new `describe` block, e.g. right after the existing `describe('recordMetric telemetry', ...)` block:

```ts
  describe('tool-call span', () => {
    beforeEach(() => {
      mockStartSpan.mockClear();
      mockSpanEnd.mockClear();
    });

    it('starts a span with the tool name and ends it with no error on success', async () => {
      const tool = new WebTool(mockParams);

      await tool.logAndExecute({
        extra: mockExtra,
        args: { param1: 'test-value' },
        callback: () => Promise.resolve(Ok({ data: 'success' })),
        constrainSuccessResult: (result) => ({ type: 'success', result }),
      });

      expect(mockStartSpan).toHaveBeenCalledWith('tableau.tool.call', {
        tool_name: 'get-datasource-metadata',
      });
      expect(mockSpanEnd).toHaveBeenCalledWith(undefined);
    });

    it('ends the span with the thrown error when the callback throws', async () => {
      const tool = new WebTool(mockParams);
      const error = new Error('boom');

      await tool.logAndExecute({
        extra: mockExtra,
        args: { param1: 'test-value' },
        callback: () => {
          throw error;
        },
        constrainSuccessResult: (result) => ({ type: 'success', result }),
      });

      expect(mockSpanEnd).toHaveBeenCalledWith(error);
    });

    it('does not throw when startSpan returns no handle', async () => {
      mockStartSpan.mockReturnValueOnce(undefined);

      const tool = new WebTool(mockParams);

      await expect(
        tool.logAndExecute({
          extra: mockExtra,
          args: { param1: 'test-value' },
          callback: () => Promise.resolve(Ok({ data: 'success' })),
          constrainSuccessResult: (result) => ({ type: 'success', result }),
        }),
      ).resolves.not.toThrow();
    });
  });
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run src/tools/web/tool.test.ts`
Expected: FAIL — `mockStartSpan` is never called.

- [ ] **Step 3: Implement the span in `WebTool.logAndExecute`**

Edit `src/tools/web/tool.ts`. Replace the block from `const productTelemetryForwarder = ...` through the end of the `finally` block (current lines 162-259):

```ts
    const productTelemetryForwarder = getProductTelemetry(
      config.productTelemetryEndpoint,
      config.productTelemetryEnabled,
      config.server,
    );

    const telemetry = getTelemetryProvider();
    const span = telemetry.startSpan?.('tableau.tool.call', { tool_name: this.name });

    let success = false;
    let errorCode = ''; // HTTP status category: "4xx", "5xx", or empty for successful calls
    let toolResult: CallToolResult | undefined;
    let spanError: unknown;

    try {
      const result = await callback();
      if (result.isOk()) {
        const constrainedResult = await constrainSuccessResult(result.value);

        if (constrainedResult.type !== 'success') {
          // Constrained result is either 'empty' or 'error'
          const isError = constrainedResult.type === 'error';
          success = !isError;
          if (isError && constrainedResult.error) {
            errorCode = getHttpStatus(constrainedResult.error);
          }
          toolResult = {
            isError,
            content: [{ type: 'text', text: constrainedResult.message }],
          };
          return toolResult;
        }

        success = true;
        toolResult = getSuccessResult
          ? getSuccessResult(constrainedResult.result)
          : {
              isError: false,
              content: [{ type: 'text', text: JSON.stringify(constrainedResult.result) }],
            };
        return toolResult;
      }

      // Handle error result - extract actual HTTP status if available
      errorCode = getHttpStatus(result.error);

      if (result.error instanceof ZodiosValidationError) {
        toolResult = getErrorResult(requestId, result.error);
        return toolResult;
      }

      toolResult = {
        isError: true,
        content: [{ type: 'text', text: result.error.getErrorText() }],
      };
      return toolResult;
    } catch (error) {
      spanError = error;
      if (error instanceof Error) {
        errorCode = getHttpStatus(error); // Default to 500 if no HTTP status can be determined
      }
      if (!errorCode) {
        errorCode = '500'; // Default to 500 if no HTTP status can be determined
      }
      log(
        {
          message: 'Tool execution failed',
          level: 'error',
          logger: 'tool',
          data: error,
        },
        extra,
      );
      toolResult = getErrorResult(requestId, error);
      return toolResult;
    } finally {
      span?.end(spanError);
      productTelemetryForwarder.send('tool_call', {
        tool_name: this.name,
        request_id: requestId.toString(),
        session_id: sessionId ?? '',
        site_luid: extra.getSiteLuid(),
        user_luid: extra.getUserLuid(),
        podname: config.server,
        is_hyperforce: config.isHyperforce,
        success,
        error_code: errorCode,
        // Only populated for genuine error results (isError: true). The ZodiosValidationError
        // passthrough returns isError: false with the full API payload, so keying off isError
        // (not !success) keeps successful response data out of telemetry.
        error_message: toolResult?.isError ? extractToolErrorMessage(toolResult) : '',
        oauth_client_id: sanitizeClientIdForTelemetry(oauthClientId),
        oauth_client_display_name:
          getClientDisplayName(oauthClientId) ?? sanitizeClientIdForTelemetry(oauthClientId),
        auth_type: getAuthTypeForTelemetry(config, tableauAuthInfo),
      });
      // Record custom metric for this tool call
      telemetry.recordMetric('mcp.tool.calls', 1, {
        tool_name: this.name,
        request_id: requestId.toString(),
        error_code: errorCode,
      });
    }
```

Note: the catch parameter is still named `error` (unchanged from before) — the outer span-error variable is named `spanError` specifically to avoid shadowing it, per the Global Constraints note on this pattern. The old `const telemetry = getTelemetryProvider();` line that used to sit inside `finally` is removed since `telemetry` is now declared once, earlier, and reused for both `startSpan` and `recordMetric`.

- [ ] **Step 4: Run it to confirm it passes**

Run: `npx vitest run src/tools/web/tool.test.ts`
Expected: PASS, including all pre-existing tests in this file.

- [ ] **Step 5: Run the full suite, then commit**

Run: `npx vitest run`
Expected: PASS.

```bash
git add src/tools/web/tool.ts src/tools/web/tool.test.ts
git commit -m "feat: add tool-call parent span to WebTool.logAndExecute"
```

---

### Task 4: OAuth token exchange span (`sdks/tableau-oauth/methods.ts`)

**Depends on:** Task 1.

**Files:**
- Modify: `src/sdks/tableau-oauth/methods.ts`
- Test: `src/sdks/tableau-oauth/methods.test.ts` (create — no test file exists for this directory today)

**Interfaces:**
- Consumes: `getClient` from `./client.js` (unchanged); `getTelemetryProvider` (new import).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the failing test file**

Create `src/sdks/tableau-oauth/methods.test.ts`:

```ts
import { getTelemetryProvider } from '../../telemetry/init.js';
import { getClient } from './client.js';
import { getTokenResult } from './methods.js';
import { TableauAccessTokenRequest } from './types.js';

vi.mock('./client.js', () => ({
  getClient: vi.fn(),
}));

vi.mock('../../telemetry/init.js', () => ({
  getTelemetryProvider: vi.fn(),
}));

describe('getTokenResult', () => {
  const basePath = 'https://my-tableau-server.com';
  const request: TableauAccessTokenRequest = {
    grant_type: 'refresh_token',
    client_id: 'test-client-id',
    refresh_token: 'test-refresh-token',
    site_namespace: 'test-site',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('starts and ends a span around the token exchange call on success', async () => {
    const mockSpan = { end: vi.fn() };
    const mockProvider = {
      initialize: vi.fn(),
      recordMetric: vi.fn(),
      recordHistogram: vi.fn(),
      startSpan: vi.fn().mockReturnValue(mockSpan),
    };
    vi.mocked(getTelemetryProvider).mockReturnValue(mockProvider);

    const mockToken = vi.fn().mockResolvedValue({
      accessToken: 'access-token',
      expiresInSeconds: 3600,
      refreshToken: 'new-refresh-token',
      originHost: 'my-tableau-server.com',
    });
    vi.mocked(getClient).mockReturnValue({ token: mockToken } as any);

    const result = await getTokenResult(basePath, request, {});

    expect(mockProvider.startSpan).toHaveBeenCalledWith('tableau.oauth.token_exchange', {
      basePath,
    });
    expect(mockToken).toHaveBeenCalledWith(request, {
      headers: expect.objectContaining({
        'Content-Type': 'application/x-www-form-urlencoded',
      }),
    });
    expect(mockSpan.end).toHaveBeenCalledWith(undefined);
    expect(result.accessToken).toBe('access-token');
  });

  it('ends the span with the error and rethrows when the token exchange fails', async () => {
    const mockSpan = { end: vi.fn() };
    const mockProvider = {
      initialize: vi.fn(),
      recordMetric: vi.fn(),
      recordHistogram: vi.fn(),
      startSpan: vi.fn().mockReturnValue(mockSpan),
    };
    vi.mocked(getTelemetryProvider).mockReturnValue(mockProvider);

    const tokenError = new Error('token exchange failed');
    const mockToken = vi.fn().mockRejectedValue(tokenError);
    vi.mocked(getClient).mockReturnValue({ token: mockToken } as any);

    await expect(getTokenResult(basePath, request, {})).rejects.toBe(tokenError);

    expect(mockSpan.end).toHaveBeenCalledWith(tokenError);
  });

  it('does not throw when the provider has no startSpan (feature-detection fallback)', async () => {
    vi.mocked(getTelemetryProvider).mockReturnValue({
      initialize: vi.fn(),
      recordMetric: vi.fn(),
      recordHistogram: vi.fn(),
    });

    const mockToken = vi.fn().mockResolvedValue({
      accessToken: 'access-token',
      expiresInSeconds: 3600,
      refreshToken: 'new-refresh-token',
      originHost: 'my-tableau-server.com',
    });
    vi.mocked(getClient).mockReturnValue({ token: mockToken } as any);

    await expect(getTokenResult(basePath, request, {})).resolves.toEqual({
      accessToken: 'access-token',
      expiresInSeconds: 3600,
      refreshToken: 'new-refresh-token',
      originHost: 'my-tableau-server.com',
    });
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run src/sdks/tableau-oauth/methods.test.ts`
Expected: FAIL — `mockProvider.startSpan` is never called.

- [ ] **Step 3: Implement the span**

Edit `src/sdks/tableau-oauth/methods.ts`:

```ts
import pkg from '../../../package.json';
import { getTelemetryProvider } from '../../telemetry/init.js';
import { AxiosRequestConfig } from '../../utils/axios.js';
import { getClient } from './client.js';
import { TableauAccessToken, TableauAccessTokenRequest } from './types.js';

export async function getTokenResult(
  basePath: string,
  request: TableauAccessTokenRequest,
  axiosConfig: AxiosRequestConfig,
): Promise<TableauAccessToken> {
  const span = getTelemetryProvider().startSpan?.('tableau.oauth.token_exchange', { basePath });
  let error: unknown;
  try {
    return await getClient(basePath, axiosConfig).token(request, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': `tableau-mcp/${pkg.version}`,
      },
    });
  } catch (caughtError) {
    error = caughtError;
    throw caughtError;
  } finally {
    span?.end(error);
  }
}
```

- [ ] **Step 4: Run it to confirm it passes**

Run: `npx vitest run src/sdks/tableau-oauth/methods.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Run the full suite, then commit**

Run: `npx vitest run`
Expected: PASS.

```bash
git add src/sdks/tableau-oauth/methods.ts src/sdks/tableau-oauth/methods.test.ts
git commit -m "feat: add span tracing to OAuth token exchange"
```

---

### Task 5: OAuth upstream signout span (`server/oauth/revoke.ts`)

**Depends on:** Task 1.

**Files:**
- Modify: `src/server/oauth/revoke.ts:105-162` (export `tryRevokeAccessToken`; add span)
- Test: `src/server/oauth/revoke.test.ts` (create — no test file exists today)

**Interfaces:**
- Consumes: `getTelemetryProvider` (new import); `mcpAccessTokenSchema`/`mcpAccessTokenUserOnlySchema` from `./schemas.js` (unchanged, already imported).
- Produces: `export async function tryRevokeAccessToken(token: string, privateKey: KeyObject, refreshTokens: Map<string, RefreshTokenData>, refreshTokenIndex: Map<string, string>): Promise<void>` — newly exported for direct testing (previously module-private), matching this repo's existing convention of testing standalone OAuth functions directly rather than through Express (e.g. `accessTokenValidator.test.ts`).

- [ ] **Step 1: Write the failing test file**

Create `src/server/oauth/revoke.test.ts`:

```ts
import { generateKeyPairSync, KeyObject } from 'crypto';
import { CompactEncrypt } from 'jose';

import { getTelemetryProvider } from '../../telemetry/init.js';
import { tryRevokeAccessToken } from './revoke.js';
import { RefreshTokenData } from './types.js';

vi.mock('../../telemetry/init.js', () => ({
  getTelemetryProvider: vi.fn(),
}));

async function encryptAccessTokenPayload(
  payload: Record<string, unknown>,
  publicKey: KeyObject,
): Promise<string> {
  return await new CompactEncrypt(new TextEncoder().encode(JSON.stringify(payload)))
    .setProtectedHeader({ alg: 'RSA-OAEP-256', enc: 'A256GCM' })
    .encrypt(publicKey);
}

describe('tryRevokeAccessToken', () => {
  let privateKey: KeyObject;
  let publicKey: KeyObject;

  const fullTokenPayload = {
    iss: 'https://mcp.example.com',
    aud: 'tableau-mcp-server',
    exp: 9999999999,
    sub: 'user@example.com',
    clientId: 'test-client-id',
    tableauServer: 'https://my-tableau-server.com',
    tableauAccessToken: 'tableau-access-token',
    tableauRefreshToken: 'tableau-refresh-token',
    tableauExpiresAt: 9999999999,
    tableauUserId: 'user-luid-123',
  };

  beforeAll(() => {
    ({ privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 }));
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('starts and ends a span around the Tableau signout fetch on success', async () => {
    const mockSpan = { end: vi.fn() };
    const mockProvider = {
      initialize: vi.fn(),
      recordMetric: vi.fn(),
      recordHistogram: vi.fn(),
      startSpan: vi.fn().mockReturnValue(mockSpan),
    };
    vi.mocked(getTelemetryProvider).mockReturnValue(mockProvider);

    const mockFetch = vi.fn().mockResolvedValue(new Response('', { status: 200 }));
    vi.stubGlobal('fetch', mockFetch);

    const token = await encryptAccessTokenPayload(fullTokenPayload, publicKey);

    await tryRevokeAccessToken(
      token,
      privateKey,
      new Map<string, RefreshTokenData>(),
      new Map<string, string>(),
    );

    expect(mockProvider.startSpan).toHaveBeenCalledWith('tableau.oauth.signout', {
      server: 'https://my-tableau-server.com',
    });
    expect(mockFetch).toHaveBeenCalledWith('https://my-tableau-server.com/api/3.24/auth/signout', {
      method: 'POST',
      headers: { 'X-Tableau-Auth': 'tableau-access-token' },
    });
    expect(mockSpan.end).toHaveBeenCalledWith(undefined);
  });

  it('ends the span with the error when the upstream signout fetch fails', async () => {
    const mockSpan = { end: vi.fn() };
    const mockProvider = {
      initialize: vi.fn(),
      recordMetric: vi.fn(),
      recordHistogram: vi.fn(),
      startSpan: vi.fn().mockReturnValue(mockSpan),
    };
    vi.mocked(getTelemetryProvider).mockReturnValue(mockProvider);

    const fetchError = new Error('network error');
    const mockFetch = vi.fn().mockRejectedValue(fetchError);
    vi.stubGlobal('fetch', mockFetch);

    const token = await encryptAccessTokenPayload(fullTokenPayload, publicKey);

    await tryRevokeAccessToken(
      token,
      privateKey,
      new Map<string, RefreshTokenData>(),
      new Map<string, string>(),
    );

    expect(mockSpan.end).toHaveBeenCalledWith(fetchError);
  });

  it('does not start a span when there is no upstream Tableau session to sign out of', async () => {
    const mockProvider = {
      initialize: vi.fn(),
      recordMetric: vi.fn(),
      recordHistogram: vi.fn(),
      startSpan: vi.fn(),
    };
    vi.mocked(getTelemetryProvider).mockReturnValue(mockProvider);

    // Client-credentials-style token: no tableauAccessToken, so there is no upstream session.
    const token = await encryptAccessTokenPayload(
      {
        iss: 'https://mcp.example.com',
        aud: 'tableau-mcp-server',
        exp: 9999999999,
        sub: 'test-client-id',
        clientId: 'test-client-id',
        tableauServer: 'https://my-tableau-server.com',
      },
      publicKey,
    );

    await tryRevokeAccessToken(
      token,
      privateKey,
      new Map<string, RefreshTokenData>(),
      new Map<string, string>(),
    );

    expect(mockProvider.startSpan).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run src/server/oauth/revoke.test.ts`
Expected: FAIL — `tryRevokeAccessToken` is not exported from `./revoke.js`.

- [ ] **Step 3: Export `tryRevokeAccessToken` and add the span**

Edit `src/server/oauth/revoke.ts`. Add the import (alphabetically, after `log`):

```ts
import { log } from '../../logging/logger.js';
import { getTelemetryProvider } from '../../telemetry/init.js';
import { mcpAccessTokenSchema, mcpAccessTokenUserOnlySchema } from './schemas.js';
import { RefreshTokenData } from './types.js';
```

Change the function declaration (current line 105):

```ts
export async function tryRevokeAccessToken(
```

Replace the best-effort signout block (current lines 145-161):

```ts
    // Best-effort signout of the upstream Tableau session
    if (tableauServer) {
      const span = getTelemetryProvider().startSpan?.('tableau.oauth.signout', {
        server: tableauServer,
      });
      let signoutError: unknown;
      try {
        await fetch(`${tableauServer}/api/3.24/auth/signout`, {
          method: 'POST',
          headers: { 'X-Tableau-Auth': tableauAccessToken },
        });
      } catch (error) {
        signoutError = error;
        log({
          message: 'Best-effort Tableau signout failed during token revocation',
          level: 'error',
          logger: 'oauth',
          data: error,
        });
      } finally {
        span?.end(signoutError);
      }
    }
```

Note: the catch parameter here is renamed-in-effect via a separate outer variable (`signoutError`), same shadowing-avoidance reasoning as Task 3 — the catch parameter itself stays named `error` to match the existing code's style.

- [ ] **Step 4: Run it to confirm it passes**

Run: `npx vitest run src/server/oauth/revoke.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Run the full suite, then commit**

Run: `npx vitest run`
Expected: PASS.

```bash
git add src/server/oauth/revoke.ts src/server/oauth/revoke.test.ts
git commit -m "feat: add span tracing to OAuth upstream signout"
```

---

### Task 6: OAuth redirect + client-metadata-fetch spans (`server/oauth/authorize.ts`)

**Depends on:** Task 1.

**Files:**
- Modify: `src/server/oauth/authorize.ts:204-400` (`getOAuthRedirectUrl`, `getClientFromMetadataDoc`)
- Test: `src/server/oauth/authorize.test.ts` (create — no test file exists today)

**Interfaces:**
- Consumes: `getTelemetryProvider` (new import).
- Produces: `export async function getOAuthRedirectUrl(initialOAuthUrl: URL, { lockSite }: { lockSite: boolean }): Promise<URL>` and `export async function getClientFromMetadataDoc(clientMetadataUrl: URL): Promise<Result<ClientMetadata, { error: string; error_description: string }>>` — both newly exported for direct testing (previously module-private); both are called only from `authorize()` in this same file, so exporting them changes no runtime behavior.

- [ ] **Step 1: Write the failing test file**

Create `src/server/oauth/authorize.test.ts`:

```ts
import { getTelemetryProvider } from '../../telemetry/init.js';
import { axios } from '../../utils/axios.js';
import { getClientFromMetadataDoc, getOAuthRedirectUrl } from './authorize.js';

vi.mock('../../telemetry/init.js', () => ({
  getTelemetryProvider: vi.fn(),
}));

vi.mock('ssrfcheck', () => ({
  isSSRFSafeURL: vi.fn().mockReturnValue(true),
}));

vi.mock('../../utils/axios.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../utils/axios.js')>();
  return {
    ...actual,
    axios: { create: vi.fn() },
  };
});

describe('getOAuthRedirectUrl', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the initial URL unchanged when the site is locked, without starting a span', async () => {
    const mockProvider = {
      initialize: vi.fn(),
      recordMetric: vi.fn(),
      recordHistogram: vi.fn(),
      startSpan: vi.fn(),
    };
    vi.mocked(getTelemetryProvider).mockReturnValue(mockProvider);

    const initialUrl = new URL('https://my-tableau-server.com/oauth2/v1/auth');
    const result = await getOAuthRedirectUrl(initialUrl, { lockSite: true });

    expect(result).toBe(initialUrl);
    expect(mockProvider.startSpan).not.toHaveBeenCalled();
  });

  it('starts and ends a span around the redirect-follow fetch on success', async () => {
    const mockSpan = { end: vi.fn() };
    const mockProvider = {
      initialize: vi.fn(),
      recordMetric: vi.fn(),
      recordHistogram: vi.fn(),
      startSpan: vi.fn().mockReturnValue(mockSpan),
    };
    vi.mocked(getTelemetryProvider).mockReturnValue(mockProvider);

    const mockFetch = vi.fn().mockResolvedValue(
      new Response('', {
        status: 302,
        headers: { location: '#/signin' },
      }),
    );
    vi.stubGlobal('fetch', mockFetch);

    const initialUrl = new URL('https://my-tableau-server.com/oauth2/v1/auth');
    const result = await getOAuthRedirectUrl(initialUrl, { lockSite: false });

    expect(mockProvider.startSpan).toHaveBeenCalledWith('tableau.oauth.site_picker_redirect');
    expect(result.hash).toBe('#/site');
    expect(mockSpan.end).toHaveBeenCalledWith(undefined);
  });

  it('ends the span with the error and falls back to the initial URL when the fetch fails', async () => {
    const mockSpan = { end: vi.fn() };
    const mockProvider = {
      initialize: vi.fn(),
      recordMetric: vi.fn(),
      recordHistogram: vi.fn(),
      startSpan: vi.fn().mockReturnValue(mockSpan),
    };
    vi.mocked(getTelemetryProvider).mockReturnValue(mockProvider);

    const fetchError = new Error('network error');
    const mockFetch = vi.fn().mockRejectedValue(fetchError);
    vi.stubGlobal('fetch', mockFetch);

    const initialUrl = new URL('https://my-tableau-server.com/oauth2/v1/auth');
    const result = await getOAuthRedirectUrl(initialUrl, { lockSite: false });

    expect(result).toBe(initialUrl);
    expect(mockSpan.end).toHaveBeenCalledWith(fetchError);
  });
});

describe('getClientFromMetadataDoc', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('starts and ends a span around the client metadata fetch on success', async () => {
    const mockSpan = { end: vi.fn() };
    const mockProvider = {
      initialize: vi.fn(),
      recordMetric: vi.fn(),
      recordHistogram: vi.fn(),
      startSpan: vi.fn().mockReturnValue(mockSpan),
    };
    vi.mocked(getTelemetryProvider).mockReturnValue(mockProvider);

    const clientMetadataUrl = new URL('https://127.0.0.1/cimd/client.json');
    const responseBody = {
      client_id: clientMetadataUrl.toString(),
      redirect_uris: ['https://client.example.com/callback'],
    };
    const mockGet = vi.fn().mockResolvedValue({
      headers: { 'content-type': 'application/json' },
      data: responseBody,
    });
    vi.mocked(axios.create).mockReturnValue({ get: mockGet } as any);

    const result = await getClientFromMetadataDoc(clientMetadataUrl);

    expect(mockProvider.startSpan).toHaveBeenCalledWith('tableau.oauth.client_metadata_fetch', {
      url: clientMetadataUrl.toString(),
    });
    expect(mockSpan.end).toHaveBeenCalledWith(undefined);
    expect(result.isOk()).toBe(true);
  });

  it('ends the span with the error when the client metadata fetch fails', async () => {
    const mockSpan = { end: vi.fn() };
    const mockProvider = {
      initialize: vi.fn(),
      recordMetric: vi.fn(),
      recordHistogram: vi.fn(),
      startSpan: vi.fn().mockReturnValue(mockSpan),
    };
    vi.mocked(getTelemetryProvider).mockReturnValue(mockProvider);

    const clientMetadataUrl = new URL('https://127.0.0.1/cimd/client-error.json');
    const fetchError = { isAxiosError: true, response: { status: 400 }, message: 'Bad Request' };
    const mockGet = vi.fn().mockRejectedValue(fetchError);
    vi.mocked(axios.create).mockReturnValue({ get: mockGet } as any);

    const result = await getClientFromMetadataDoc(clientMetadataUrl);

    expect(result.isErr()).toBe(true);
    expect(mockSpan.end).toHaveBeenCalledWith(fetchError);
  });
});
```

Note on test design: both `getClientFromMetadataDoc` tests use an IP-literal hostname (`127.0.0.1`), which makes `isIP(clientMetadataUrl.hostname)` truthy and skips the DNS-resolution branch entirely — so no DNS resolver mocking is needed. `ssrfcheck`'s `isSSRFSafeURL` is mocked to `true` since SSRF-safety validation isn't the tracing behavior under test (it would otherwise reject a loopback address by design). The error-path mock rejects with an axios-error-shaped object with `response.status: 400` so `retry`'s `retryIf` returns `false` and the call fails immediately with no retry delay.

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run src/server/oauth/authorize.test.ts`
Expected: FAIL — `getOAuthRedirectUrl`/`getClientFromMetadataDoc` are not exported from `./authorize.js`.

- [ ] **Step 3: Export both functions and add spans**

Edit `src/server/oauth/authorize.ts`. Add the import (alphabetically, between `log` and `utils/axios.js`):

```ts
import { getConfig } from '../../config.js';
import { log } from '../../logging/logger.js';
import { getTelemetryProvider } from '../../telemetry/init.js';
import { axios, AxiosResponse, getStringResponseHeader, isAxiosError } from '../../utils/axios.js';
```

Replace `getOAuthRedirectUrl` (current lines 204-241):

```ts
export async function getOAuthRedirectUrl(
  initialOAuthUrl: URL,
  { lockSite }: { lockSite: boolean },
): Promise<URL> {
  if (lockSite) {
    // When the site is locked, Tableau does the right thing and never shows the site picker,
    // regardless of whether the user already has an active Tableau session in their browser.
    return initialOAuthUrl;
  }

  // When the site is not locked, Tableau does the right thing and shows the site picker, but only on Cloud.
  // On Server, if the user does not have an active Tableau session in their browser,
  // Tableau does not show the site picker.
  // We can force it to by changing the path from #/signin to #/site.

  const span = getTelemetryProvider().startSpan?.('tableau.oauth.site_picker_redirect');
  let redirectError: unknown;
  try {
    const response = await fetch(initialOAuthUrl, { redirect: 'manual' });
    if (response.status === 302) {
      // The response is a redirect to the Tableau OAuth login page.
      // Force it to ultimately show the site picker by changing the path from #/signin to #/site.
      const location = response.headers.get('location');
      if (location?.startsWith('#/signin') || location?.startsWith('/#/signin')) {
        const locationUrl = new URL(location.replace('#/signin', '#/site'), initialOAuthUrl.origin);
        return locationUrl;
      }
    }
  } catch (error) {
    redirectError = error;
    log({
      message: 'Failed to follow Tableau OAuth redirect for site picker',
      level: 'error',
      logger: 'oauth',
      data: error,
    });
    return initialOAuthUrl;
  } finally {
    span?.end(redirectError);
  }

  return initialOAuthUrl;
}
```

Replace `getClientFromMetadataDoc`'s declaration and its axios-call try/catch (current lines 244-338; everything from the function signature down through the DNS-resolution and SSRF-check blocks is unchanged — only the signature gains `export` and the try/catch gains the span):

```ts
// https://client.dev/servers
export async function getClientFromMetadataDoc(
  clientMetadataUrl: URL,
): Promise<Result<ClientMetadata, { error: string; error_description: string }>> {
  const originalUrl = clientMetadataUrl.toString();
  const cache = clientMetadataCache.get(originalUrl);
  if (cache) {
    return Ok(cache);
  }

  const originalHostname = clientMetadataUrl.hostname;
  if (!isIP(clientMetadataUrl.hostname)) {
    try {
      // Resolve the IP from DNS
      const dnsResolver = getDnsResolver();
      const resolvedIps = await dnsResolver.resolve4(clientMetadataUrl.hostname);
      let ipAddress = resolvedIps.find(Boolean);
      if (!ipAddress) {
        const resolvedIps = await dnsResolver.resolve6(clientMetadataUrl.hostname);
        ipAddress = resolvedIps.find(Boolean);
        if (!ipAddress) {
          return Err({
            error: 'invalid_request',
            error_description: 'IP address of Client Metadata URL could not be resolved',
          });
        }
      }
      // Replace the hostname with the resolved IP Address
      clientMetadataUrl.hostname = ipAddress;
    } catch (error) {
      log({
        message: `DNS resolution failed for client metadata URL ${clientMetadataUrl.hostname}`,
        level: 'error',
        logger: 'oauth',
        data: error,
      });
      return Err({
        error: 'invalid_request',
        error_description: 'IP address of Client Metadata URL could not be resolved',
      });
    }
  }

  const isSafe = isSSRFSafeURL(clientMetadataUrl.toString(), {
    allowedProtocols: ['https'],
    autoPrependProtocol: false,
  });

  if (!isSafe) {
    return Err({
      error: 'invalid_request',
      error_description: 'Client Metadata URL is not allowed',
    });
  }

  let response: AxiosResponse;
  const span = getTelemetryProvider().startSpan?.('tableau.oauth.client_metadata_fetch', {
    url: originalUrl,
  });
  let fetchError: unknown;
  try {
    const client = axios.create();
    response = await retry(
      () =>
        client.get(clientMetadataUrl.toString(), {
          timeout: 5000,
          maxContentLength: 5 * 1024, // 5 KB
          maxRedirects: 3,
          headers: {
            Accept: 'application/json',
            Host: originalHostname,
          },
        }),
      {
        retryIf: (error) => {
          if (!isAxiosError(error)) {
            return true;
          }

          const status = error.response?.status;
          if (status) {
            return status >= 500 && status < 600;
          }

          return true;
        },
      },
    );
  } catch (error) {
    fetchError = error;
    log({
      message: `Failed to fetch client metadata from ${originalUrl}`,
      level: 'error',
      logger: 'oauth',
      data: error,
    });
    return Err({
      error: 'invalid_request',
      error_description: 'Unable to fetch client metadata',
    });
  } finally {
    span?.end(fetchError);
  }

  // ... everything from here (contentType check through the final `return Ok(...)`) is unchanged ...
```

Everything after this point in the function (content-type validation, schema parsing, cache-control handling, the final `return Ok(clientMetadataResult.data)`) stays exactly as it is today — only the signature (`export`) and the axios-call try/catch/finally change.

- [ ] **Step 4: Run it to confirm it passes**

Run: `npx vitest run src/server/oauth/authorize.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Run the full suite, then commit**

Run: `npx vitest run`
Expected: PASS.

```bash
git add src/server/oauth/authorize.ts src/server/oauth/authorize.test.ts
git commit -m "feat: add span tracing to OAuth redirect and client metadata fetch"
```

---

### Task 7: Product telemetry forwarder span (`telemetryForwarder.ts`)

**Depends on:** Task 1.

**Files:**
- Modify: `src/telemetry/productTelemetry/telemetryForwarder.ts:88-107` (`sendTelemetryRequest`)
- Test: `src/telemetry/productTelemetry/telemetryForwarder.test.ts` (extend)

**Interfaces:**
- Consumes: `getTelemetryProvider` (new import).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the failing test**

Add to `src/telemetry/productTelemetry/telemetryForwarder.test.ts`. Add the mock and import at the top (before the existing `describe` block):

```ts
import { getTelemetryProvider } from '../init.js';
import {
  exportedForTesting,
  getProductTelemetry,
  TableauTelemetryJsonEvent,
} from './telemetryForwarder.js';

vi.mock('../init.js', () => ({
  getTelemetryProvider: vi.fn(),
}));
```

Add a new `it` inside the existing `describe('DirectTelemetryForwarder', ...)` block, and set a default `startSpan` mock in the existing `beforeEach` so it doesn't crash on the guard call other tests exercise indirectly:

```ts
  beforeEach(() => {
    exportedForTesting.resetProductTelemetry();
    mockFetch.mockImplementation(() => {
      return Promise.resolve(new Response('', { status: 200 }));
    });
    vi.stubGlobal('fetch', mockFetch);
    vi.mocked(getTelemetryProvider).mockReturnValue({
      initialize: vi.fn(),
      recordMetric: vi.fn(),
      recordHistogram: vi.fn(),
      startSpan: vi.fn().mockReturnValue({ end: vi.fn() }),
    });
  });
```

```ts
  it('starts and ends a span around the outbound telemetry fetch on success', async () => {
    const mockSpan = { end: vi.fn() };
    const mockProvider = {
      initialize: vi.fn(),
      recordMetric: vi.fn(),
      recordHistogram: vi.fn(),
      startSpan: vi.fn().mockReturnValue(mockSpan),
    };
    vi.mocked(getTelemetryProvider).mockReturnValue(mockProvider);

    const forwarder = getProductTelemetry(endpoint, true, podName);
    forwarder.send('tool_call', { foo: 'bar' });

    // sendTelemetryRequest is fire-and-forget from send()'s perspective; flush microtasks.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mockProvider.startSpan).toHaveBeenCalledWith(
      'tableau.telemetry.forward',
      expect.objectContaining({ url: expect.stringContaining(endpoint) }),
    );
    expect(mockSpan.end).toHaveBeenCalledWith(undefined);
  });

  it('ends the span with the error when the outbound telemetry fetch throws', async () => {
    const mockSpan = { end: vi.fn() };
    const mockProvider = {
      initialize: vi.fn(),
      recordMetric: vi.fn(),
      recordHistogram: vi.fn(),
      startSpan: vi.fn().mockReturnValue(mockSpan),
    };
    vi.mocked(getTelemetryProvider).mockReturnValue(mockProvider);

    const fetchError = new Error('network error');
    mockFetch.mockRejectedValueOnce(fetchError);

    const forwarder = getProductTelemetry(endpoint, true, podName);
    forwarder.send('tool_call', { foo: 'bar' });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mockSpan.end).toHaveBeenCalledWith(fetchError);
  });
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run src/telemetry/productTelemetry/telemetryForwarder.test.ts`
Expected: FAIL — `mockProvider.startSpan` is never called.

- [ ] **Step 3: Implement the span**

Edit `src/telemetry/productTelemetry/telemetryForwarder.ts`. Add the import at the top:

```ts
import os from 'os';

import { log } from '../../logging/logger';
import { getTelemetryProvider } from '../init.js';
```

Replace `sendTelemetryRequest` (current lines 88-107):

```ts
async function sendTelemetryRequest(req: Request): Promise<void> {
  const span = getTelemetryProvider().startSpan?.('tableau.telemetry.forward', { url: req.url });
  let error: unknown;
  try {
    const res = await fetch(req);
    const body = await res.text();
    if (!res.ok) {
      log({
        message: `Telemetry request failed: ${res.status} ${res.statusText} - ${body}`,
        level: 'error',
        logger: 'telemetry',
      });
    }
  } catch (caughtError) {
    error = caughtError;
    log({
      message: 'Telemetry request failed',
      level: 'error',
      logger: 'telemetry',
      data: error,
    });
  } finally {
    span?.end(error);
  }
}
```

- [ ] **Step 4: Run it to confirm it passes**

Run: `npx vitest run src/telemetry/productTelemetry/telemetryForwarder.test.ts`
Expected: PASS, including all pre-existing tests in this file.

- [ ] **Step 5: Run the full suite, then commit**

Run: `npx vitest run`
Expected: PASS.

```bash
git add src/telemetry/productTelemetry/telemetryForwarder.ts src/telemetry/productTelemetry/telemetryForwarder.test.ts
git commit -m "feat: add span tracing to product telemetry forwarder"
```

---

### Task 8: S3 staged upload spans (`tools/web/s3Client.ts`)

**Depends on:** Task 1.

**Files:**
- Modify: `src/tools/web/s3Client.ts` (`uploadBufferToS3`, `downloadObjectFromS3` — NOT `createPresignedPutUrlToS3`, which makes no network call)
- Test: `src/tools/web/s3Client.test.ts` (create — no test file exists today)

**Interfaces:**
- Consumes: `getTelemetryProvider` (new import); `exportedForTesting.resetS3Bundle()` (already exists, used by the test to force `getS3Bundle` to reconstruct against mocked AWS SDK modules each test).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the failing test file**

Create `src/tools/web/s3Client.test.ts`:

```ts
import { getTelemetryProvider } from '../../telemetry/init.js';
import { downloadObjectFromS3, exportedForTesting, uploadBufferToS3 } from './s3Client.js';

const mockSend = vi.hoisted(() => vi.fn());
const mockGetSignedUrl = vi.hoisted(() =>
  vi.fn().mockResolvedValue('https://signed-url.example.com'),
);

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn().mockImplementation(() => ({ send: mockSend })),
  PutObjectCommand: vi.fn().mockImplementation((input) => ({ input })),
  GetObjectCommand: vi.fn().mockImplementation((input) => ({ input })),
}));

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: mockGetSignedUrl,
}));

vi.mock('../../telemetry/init.js', () => ({
  getTelemetryProvider: vi.fn(),
}));

describe('s3Client span tracing', () => {
  const bucket = 'test-bucket';
  const region = 'us-east-1';
  const key = 'test-key';

  beforeEach(() => {
    vi.clearAllMocks();
    exportedForTesting.resetS3Bundle();
    mockGetSignedUrl.mockResolvedValue('https://signed-url.example.com');
  });

  describe('uploadBufferToS3', () => {
    it('starts and ends a span around the S3 PutObjectCommand on success', async () => {
      mockSend.mockResolvedValue({});
      const mockSpan = { end: vi.fn() };
      const mockProvider = {
        initialize: vi.fn(),
        recordMetric: vi.fn(),
        recordHistogram: vi.fn(),
        startSpan: vi.fn().mockReturnValue(mockSpan),
      };
      vi.mocked(getTelemetryProvider).mockReturnValue(mockProvider);

      await uploadBufferToS3(Buffer.from('hello'), {
        key,
        contentType: 'text/plain',
        bucket,
        region,
        presignTtlSeconds: 60,
      });

      expect(mockProvider.startSpan).toHaveBeenCalledWith('tableau.s3.upload', { bucket, key });
      expect(mockSpan.end).toHaveBeenCalledWith(undefined);
    });

    it('ends the span with the error and rethrows when the upload fails', async () => {
      const uploadError = new Error('upload failed');
      mockSend.mockRejectedValue(uploadError);
      const mockSpan = { end: vi.fn() };
      const mockProvider = {
        initialize: vi.fn(),
        recordMetric: vi.fn(),
        recordHistogram: vi.fn(),
        startSpan: vi.fn().mockReturnValue(mockSpan),
      };
      vi.mocked(getTelemetryProvider).mockReturnValue(mockProvider);

      await expect(
        uploadBufferToS3(Buffer.from('hello'), {
          key,
          contentType: 'text/plain',
          bucket,
          region,
          presignTtlSeconds: 60,
        }),
      ).rejects.toBe(uploadError);

      expect(mockSpan.end).toHaveBeenCalledWith(uploadError);
    });
  });

  describe('downloadObjectFromS3', () => {
    it('starts and ends a span around the S3 GetObjectCommand on success', async () => {
      mockSend.mockResolvedValue({ Body: Buffer.from('hello') });
      const mockSpan = { end: vi.fn() };
      const mockProvider = {
        initialize: vi.fn(),
        recordMetric: vi.fn(),
        recordHistogram: vi.fn(),
        startSpan: vi.fn().mockReturnValue(mockSpan),
      };
      vi.mocked(getTelemetryProvider).mockReturnValue(mockProvider);

      const result = await downloadObjectFromS3({ key, bucket, region, maxBytes: 1024 });

      expect(mockProvider.startSpan).toHaveBeenCalledWith('tableau.s3.download', { bucket, key });
      expect(mockSpan.end).toHaveBeenCalledWith(undefined);
      expect(result.toString()).toBe('hello');
    });

    it('ends the span with the error and rethrows when the download fails', async () => {
      const downloadError = new Error('download failed');
      mockSend.mockRejectedValue(downloadError);
      const mockSpan = { end: vi.fn() };
      const mockProvider = {
        initialize: vi.fn(),
        recordMetric: vi.fn(),
        recordHistogram: vi.fn(),
        startSpan: vi.fn().mockReturnValue(mockSpan),
      };
      vi.mocked(getTelemetryProvider).mockReturnValue(mockProvider);

      await expect(downloadObjectFromS3({ key, bucket, region, maxBytes: 1024 })).rejects.toBe(
        downloadError,
      );

      expect(mockSpan.end).toHaveBeenCalledWith(downloadError);
    });
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run src/tools/web/s3Client.test.ts`
Expected: FAIL — `mockProvider.startSpan` is never called.

- [ ] **Step 3: Implement the spans**

Edit `src/tools/web/s3Client.ts`. Add an import after the module's top-of-file doc comment (this file currently has no imports):

```ts
/**
 * Shared S3 upload core.
 * ...(existing doc comment unchanged)...
 */

import { getTelemetryProvider } from '../../telemetry/init.js';

/**
 * Socket-idle timeouts (ms) for the S3 client's Node HTTP handler.
 * ...(unchanged)...
 */
```

Replace `uploadBufferToS3` (current lines 126-156):

```ts
export async function uploadBufferToS3(
  buffer: Buffer,
  {
    key,
    contentType,
    bucket,
    region,
    presignTtlSeconds,
  }: {
    key: string;
    contentType: string;
    bucket: string;
    region: string;
    presignTtlSeconds: number;
  },
): Promise<string> {
  const { client, PutObjectCommand, GetObjectCommand, getSignedUrl } = await getS3Bundle(region);

  const span = getTelemetryProvider().startSpan?.('tableau.s3.upload', { bucket, key });
  let error: unknown;
  try {
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: buffer,
        ContentType: contentType,
      }),
    );
  } catch (caughtError) {
    error = caughtError;
    throw caughtError;
  } finally {
    span?.end(error);
  }

  return await getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), {
    expiresIn: presignTtlSeconds,
  });
}
```

Replace `downloadObjectFromS3` (current lines 184-209):

```ts
export async function downloadObjectFromS3({
  key,
  bucket,
  region,
  maxBytes,
}: {
  key: string;
  bucket: string;
  region: string;
  maxBytes: number;
}): Promise<Buffer> {
  const { client, GetObjectCommand } = await getS3Bundle(region);

  const span = getTelemetryProvider().startSpan?.('tableau.s3.download', { bucket, key });
  let response: any;
  let error: unknown;
  try {
    response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  } catch (caughtError) {
    error = caughtError;
    throw caughtError;
  } finally {
    span?.end(error);
  }

  if (response.ContentLength !== undefined) {
    const contentLength = Number(response.ContentLength);
    if (!Number.isSafeInteger(contentLength) || contentLength < 0) {
      throw new Error('S3 object has an invalid byte length.');
    }
    if (contentLength > maxBytes) {
      throw new Error(`S3 object exceeds the ${maxBytes}-byte limit.`);
    }
  }

  return await bodyToBufferBounded(response.Body, maxBytes);
}
```

(`response: any` matches this file's existing loose typing for the S3 bundle — `client`, the AWS SDK command classes, and `getSignedUrl` are all already typed `any` throughout this file.)

- [ ] **Step 4: Run it to confirm it passes**

Run: `npx vitest run src/tools/web/s3Client.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Run the full suite, then commit**

Run: `npx vitest run`
Expected: PASS.

```bash
git add src/tools/web/s3Client.ts src/tools/web/s3Client.test.ts
git commit -m "feat: add span tracing to S3 staged upload/download"
```

---

## Self-Review

**1. Spec coverage:**
- `SpanHandle`/`startSpan?` primitive on the published interface → Task 1, Step 1. ✓
- `NoOpTelemetryProvider` trivial no-op implementation → Task 1, Step 4. ✓
- `validateTelemetryProvider` fixed to a hardcoded required-methods list, backward-compatible → Task 1, Step 8. ✓
- REST API axios interceptors (covers VizQL Data Service + Metadata API for free, since they share the same interceptor registration) → Task 2. ✓
- Tool-call parent span → Task 3. ✓
- OAuth token exchange → Task 4. ✓
- OAuth upstream signout → Task 5. ✓
- OAuth site-picker redirect follow → Task 6 (`getOAuthRedirectUrl`). ✓
- OAuth Client ID Metadata Document fetch → Task 6 (`getClientFromMetadataDoc`). ✓
- Product telemetry forwarder → Task 7. ✓
- S3 staged upload (`uploadBufferToS3`, `downloadObjectFromS3`; explicitly not `createPresignedPutUrlToS3`) → Task 8. ✓
- Explicitly excluded: Desktop Agent API client, `MonCloudTelemetryProvider` — neither is touched by any task. ✓
- Testing: extend existing suites where they exist (Tasks 1–3, 7); create new suites only where none exist (Tasks 4, 5, 6, 8) — matches the spec's stated testing convention. ✓
- No sampling/exporter/context-propagation code was added — every task only starts/ends spans via the interface; nesting relies entirely on the concrete provider's own OTel context manager, per the spec's "Nesting is automatic" section. ✓

No spec requirement was found without a corresponding task.

**2. Placeholder scan:** Every task's implementation and test code blocks above are complete, runnable TypeScript — no "TBD", no "similar to Task N" (Task 6's diff for `getClientFromMetadataDoc` explicitly reproduces every unchanged line rather than eliding it), no "add appropriate error handling" prose without code. The one intentional elision is Task 6 Step 3's trailing comment ("... everything from here ... is unchanged ..."), which is accurate — those lines truly don't change — not a stand-in for unwritten logic.

**3. Type/signature consistency:**
- `SpanHandle.end(error?: unknown): void` (Task 1) is called identically everywhere: `span?.end(error)` / `span?.end()` (Tasks 2–8) — no task calls it with a different arity or a differently-named field.
- `TelemetryProvider.startSpan?(name: string, attributes?: TelemetryAttributes): SpanHandle` (Task 1) is called identically as `getTelemetryProvider().startSpan?.(name, attrs)` everywhere it's used (Tasks 2–8); Task 2's REST API path is the only one that stores the returned handle (in the `WeakMap`) rather than holding it in a local `const span`, since it must survive across two separate callback invocations.
- `rawConfig` (Task 2) is spelled identically across `interceptors.ts`'s two type definitions, `restApi.ts`'s two population sites, and `restApiInstance.ts`'s two read sites.
- `tryRevokeAccessToken` (Task 5) and `getOAuthRedirectUrl`/`getClientFromMetadataDoc` (Task 6) keep their exact pre-existing parameter names, order, and return types when changed from private to exported — only the `export` keyword and internal span logic change, so no caller-facing signature drifted.
- The single-call-site pattern's outer error variable is deliberately named `spanError` (Task 3, inside a function with a `catch (error)` clause) and `signoutError` (Task 5, same reason) instead of reusing `error`, to avoid shadowing — called out explicitly in Global Constraints so a task's implementer reading only their own task still understands why the variable isn't literally named `error` there, matching the pattern shown in Tasks 4, 6, 7, and 8 where no such collision exists.

No inconsistencies found.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-31-telemetry-provider-tracing.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
