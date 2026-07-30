export type TransportProfile = 'desktop' | 'web';

// The shipped tableau-mcp-desktop binary serves one profile per process, selected by
// TRANSPORT. Validate here (rather than treating "not stdio" as web) so a typo fails
// fast instead of failing open to the OAuth-disabled HTTP startup path: getConfig()
// would normalize an unknown transport back to stdio while this entrypoint had already
// started the Express server against it.
export function resolveTransportProfile(transport: string | undefined): TransportProfile {
  const t = transport ?? 'stdio';
  if (t === 'stdio') {
    return 'desktop';
  }
  if (t === 'http') {
    return 'web';
  }
  throw new Error(
    `Unsupported TRANSPORT "${t}" for the tableau-mcp-desktop server; expected "stdio" (desktop authoring profile) or "http" (web/insights profile).`,
  );
}
