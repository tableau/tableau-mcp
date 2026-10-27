import { DEFAULT_PRODUCT_TELEMETRY_ENDPOINT } from './telemetry/productTelemetry/telemetryEndpoint.js';

// sendTelemetryRequest swallows fetch errors, so a throwing guard would vanish: record the call
// and fail in afterEach instead. Matches the default host and the currently configured endpoint.
const telemetryCalls: string[] = [];
const realFetch = globalThis.fetch;

function urlOf(input: Parameters<typeof fetch>[0]): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
}

function hostOf(url: string | undefined): string | undefined {
  try {
    return url ? new URL(url).host : undefined;
  } catch {
    return undefined;
  }
}

function isTelemetryUrl(url: string): boolean {
  const host = hostOf(url);
  return (
    host !== undefined &&
    (host === hostOf(DEFAULT_PRODUCT_TELEMETRY_ENDPOINT) ||
      host === hostOf(process.env.PRODUCT_TELEMETRY_ENDPOINT))
  );
}

globalThis.fetch = (async (input, init) => {
  const url = urlOf(input);
  if (isTelemetryUrl(url)) {
    telemetryCalls.push(url);
    return new Response('', { status: 200 });
  }
  return realFetch(input, init);
}) as typeof fetch;

afterEach(() => {
  const calls = telemetryCalls.splice(0);
  if (calls.length > 0) {
    throw new Error(`Test sent product telemetry to ${calls[0]} (${calls.length} call(s))`);
  }
});
