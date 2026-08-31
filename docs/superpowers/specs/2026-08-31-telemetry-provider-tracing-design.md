# TelemetryProvider Tracing Support — Design Spec

**Status:** Approved by user 2026-08-31. Ready for implementation planning.

## Context

`tabhf-mcp-svc` (a self-hosted deployment consuming `@tableau/mcp-server`) recently shipped
distributed-tracing spans in its own `MonCloudTelemetryProvider` (`recordSpan`/`recordErrorSpan`,
PR #128) purely by calling `@opentelemetry/api` directly — no change to tableau-mcp was needed
there, because those spans wrap code that runs entirely inside tabhf-mcp-svc's own process.

This spec covers the complementary, tableau-mcp-side half: giving tableau-mcp's own request
handling and outbound calls span coverage, exposed through the published `TelemetryProvider`
interface so that any custom provider (including `MonCloudTelemetryProvider`, as a later,
separate follow-up) can receive and export those spans through its own tracer.

**Motivating principle (user-stated):** each call to an external dependency should get its own
span, not just one span per tool call. A tool call that's slow because a single REST call to
Tableau took 3 seconds should show that as a child span, not be invisible inside one coarse
tool-level span.

**Scope note:** `MonCloudTelemetryProvider` implementing the new interface method is explicitly
OUT of scope for this work — tableau-mcp only, for now.

## Goals

- Add span coverage for tableau-mcp's own tool-call handling and every outbound call to an
  external dependency, matching per-call granularity (one span per individual HTTP/SDK call,
  not one span per logical multi-call operation).
- Keep the published `TelemetryProvider` interface fully backward-compatible: existing external
  custom providers that predate this change must keep working unchanged, with no silent
  degradation of their existing metrics support.
- Keep the interface itself free of runtime dependencies (no OpenTelemetry types leak into the
  published type), consistent with the existing header comment on `telemetryProvider.ts`.

## Non-goals

- No change to `MonCloudTelemetryProvider` (tabhf-mcp-svc) to implement the new method — deferred,
  separate follow-up.
- No coverage of the Desktop Agent API client (`src/desktop/getAgentApiClient.ts`) — explicitly
  excluded by the user.
- No sampling/exporter configuration changes — this only adds instrumentation points; how spans
  are sampled/exported is entirely the concern of whatever concrete provider implements
  `startSpan`.
- No automatic context-propagation code (e.g. LUID-style closure threading) needs to be added for
  span nesting — see "Nesting is automatic" below.

## Interface Design

Add one new primitive to `src/telemetry/telemetryProvider.ts`, alongside the existing
`initialize`/`recordMetric`/`recordHistogram`:

```ts
export interface SpanHandle {
  /** Ends the span. Pass the error if the operation failed. */
  end(error?: unknown): void;
}

export interface TelemetryProvider {
  // ... existing methods unchanged ...

  /**
   * Starts a span and returns a handle to end it later. Optional: providers that
   * don't implement tracing simply don't have this method, and call sites must
   * feature-detect it (`provider.startSpan?.(...)`).
   */
  startSpan?(name: string, attributes?: TelemetryAttributes): SpanHandle;
}
```

This is a single low-level "start now, end later" primitive rather than a wrap-a-function
convenience (`recordSpan`-style). It's strictly more general: every call site found during
design — a single `await fetch(...)`, a pair of independently-invoked axios interceptors, or an
AWS SDK `client.send(...)` call — can start the span immediately before the call and end it
wherever that call's result (or failure) becomes known, whether that's three lines down in the
same function or in a completely different callback fired later. A wrap-fn wasn't added because
every real call site here already has (or gets) its own try/finally; adding a second interface
method that's just sugar over the same primitive isn't justified.

`NoOpTelemetryProvider` (`src/telemetry/noop.ts`) implements it as a trivial no-op:

```ts
startSpan(): SpanHandle {
  return { end: () => {} };
}
```

## Backward Compatibility

`validateTelemetryProvider` (`src/telemetry/init.ts`) currently checks that a loaded custom
provider implements every method present on `NoOpTelemetryProvider`'s own prototype. If
`startSpan` is added to `NoOpTelemetryProvider` without changing this check, it becomes a
de-facto *required* method at runtime for any existing external custom provider — silently
breaking their metrics too (`validateTelemetryProvider` fails closed on a missing method), not
just leaving tracing unavailable. That would contradict "fully backward-compatible."

Fix: change `validateTelemetryProvider` to check a fixed, explicit list of required methods
(`initialize`, `recordMetric`, `recordHistogram`) rather than deriving the required set from
`NoOpTelemetryProvider`'s prototype. `startSpan` stays genuinely optional at both the type level
(`?`) and the runtime-validation level. Every call site that wants to use it must feature-detect:

```ts
const span = telemetryProvider.startSpan?.('tableau.tool.call', { tool_name });
try {
  // ...
} finally {
  span?.end(error);
}
```

## Nesting is automatic

A span started while another span is active automatically becomes that span's child, via
OpenTelemetry's own execution-context propagation (e.g. `AsyncLocalStorage`-based), *provided*
the concrete provider registers a real OTel context manager (as `MonCloudTelemetryProvider`
already does via `Apm.start()`). tableau-mcp needs no explicit parent-linking code for this —
it's fundamentally different from the LUID pattern (`src/logging/logger.ts`'s `LuidContext`),
which needs explicit closure-threading only because LUID *values* have no execution-context
carrier of their own. A tool-call span (started in `WebTool.logAndExecute`) and a REST-call span
(started later, during that same call's execution) nest correctly with zero extra code in
tableau-mcp, as long as the underlying provider is OTel-backed.

## Call Sites

Two calling patterns cover every boundary identified. Both use the same `startSpan`/`SpanHandle`
primitive; they differ only in *where* `.end()` is called.

### Interceptor-pair pattern (start and end are two separate callback invocations)

**`src/restApiInstance.ts`** — the main Tableau REST API client's axios interceptors
(`getRequestInterceptor`, `getResponseInterceptor`, `getRequestErrorInterceptor`,
`getResponseErrorInterceptor`). These are independently-invoked callbacks, not a single wrappable
function boundary, so per-individual-HTTP-call granularity requires starting the span in the
request interceptor and ending it in the matching response/error interceptor. Correlate the two
invocations via a module-level `WeakMap<AxiosRequestConfig, SpanHandle>` keyed on the request
config object — axios preserves that same object reference through to `response.config` and
`error.config`, since the existing interceptors mutate and return the same object rather than
returning a new one. No explicit cleanup call is needed: a `WeakMap` entry is garbage-collection-
eligible as soon as nothing else references the config object, so a response that never arrives
can't leak a `SpanHandle` — this is the reason to use `WeakMap` here instead of `Map`.

This single boundary also covers, for free, every API that shares the same `RestApi`/Zodios
interceptor registration:
- VizQL Data Service (`src/sdks/tableau/methods/vizqlDataServiceMethods.ts`)
- Metadata API / GraphQL (`src/sdks/tableau/methods/metadataMethods.ts`)

### Single-call-site pattern (start immediately before the call, end in a local `finally`)

No correlation mechanism needed — each of these is one synchronous `await`, not split across two
independently-fired callbacks:

- **Tool-call span (parent)** — `src/tools/web/tool.ts`, `WebTool.logAndExecute`. Wraps the whole
  tool callback execution, inside the existing try/catch/finally. This is the span that every
  REST-call/OAuth/S3 child span (started during that callback's execution) nests under.
- **OAuth token exchange** — `src/sdks/tableau-oauth/methods.ts`, `getTokenResult`, wrapping
  `getClient(basePath, axiosConfig).token(request, {...})`. A one-shot Zodios call with no
  interceptors of its own.
- **OAuth upstream signout** — `src/server/oauth/revoke.ts:148`, the `fetch()` call inside
  `tryRevokeAccessToken`. Already inside a try/catch that logs and swallows failure (best-effort
  signout); the span wraps that same `fetch()` call.
- **OAuth site-picker redirect follow** — `src/server/oauth/authorize.ts:220`, a raw `fetch()`.
- **OAuth Client ID Metadata Document fetch** — `src/server/oauth/authorize.ts:300`,
  `getClientFromMetadataDoc`'s one-shot `axios.create()` client.
- **Product telemetry forwarder** — `src/telemetry/productTelemetry/telemetryForwarder.ts:90`,
  the `fetch(req)` call inside `sendTelemetryRequest`. The caller (`send()`) doesn't await this,
  but `sendTelemetryRequest` itself is a real async function with its own try/catch — the span
  starts and ends correctly within it regardless of whether the top-level caller awaits the
  returned promise.
- **S3 staged upload** — `src/tools/web/s3Client.ts`: the two calls that actually hit the network,
  `client.send(new PutObjectCommand(...))` in `uploadBufferToS3` and
  `client.send(new GetObjectCommand(...))` in `downloadObjectFromS3`. `createPresignedPutUrlToS3`
  makes no network call (presigning is local SigV4 computation) and needs no span.

### Explicitly excluded

- Desktop Agent API client (`src/desktop/getAgentApiClient.ts`) — separate axios/Zodios instance
  with its own interceptors; excluded per user instruction.

## Testing

- `src/telemetry/init.test.ts` — extend existing `validateTelemetryProvider` tests to confirm a
  custom provider missing `startSpan` still validates successfully (the backward-compat
  contract), and that a provider *with* `startSpan` is accepted too.
- `src/telemetry/noop.test.ts` — extend to cover `startSpan` returning a working no-op handle.
- For each call site, extend that file's existing test suite (not new parallel test files, per
  this repo's testing convention) to assert `startSpan`/`.end()` are invoked with reasonable
  arguments when a `startSpan`-capable provider is configured, and that behavior is unchanged
  when it isn't (feature-detection fallback).
- No new test infrastructure needed: OTel's own no-op tracer already makes span calls inert
  without a real `TracerProvider` registered, so existing tests that don't configure tracing stay
  green untouched.

## Out of Scope / Deferred Follow-ups

- `MonCloudTelemetryProvider` (tabhf-mcp-svc) implementing `startSpan`.
- Desktop Agent API client span coverage.
- Any exporter/sampling configuration.
