// Imported before testTelemetryGuard so that guard wraps this one and still sees telemetry calls.
// This guard sees `fetch` only (not axios or node:http).
// Callers swallow fetch errors, so record blocked hosts and fail in afterEach.
const realFetch = globalThis.fetch;
const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '[::1]']);
const blockedCalls: { host: string; test: string | undefined }[] = [];

globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
  const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const { hostname } = new URL(rawUrl);
  if (!LOOPBACK_HOSTNAMES.has(hostname)) {
    blockedCalls.push({ host: hostname, test: expect.getState().currentTestName });
    throw new Error(`network disabled in embedded OAuth tests: ${hostname}`);
  }
  return realFetch(input, init);
}) as typeof fetch;

afterEach(() => {
  const calls = blockedCalls.splice(0);
  if (calls.length > 0) {
    const hosts = [...new Set(calls.map(({ host }) => host))].join(', ');
    throw new Error(
      `Test "${calls[0].test}" made a non-loopback fetch to ${hosts} (${calls.length} call(s)); stub it in the test`,
    );
  }
});
