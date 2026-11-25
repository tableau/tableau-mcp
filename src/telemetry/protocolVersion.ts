import { Server } from '../server.js';
import { TableauRequestHandlerExtra } from '../tools/toolContext.js';

/** Resolve the protocol used by this call, rather than the client or server SDK version. */
export function getProtocolVersionForTelemetry(extra: TableauRequestHandlerExtra<Server>): string {
  const version =
    extra.protocolVersion ??
    extra.requestInfo?.headers.get('MCP-Protocol-Version') ??
    // Legacy stdio and session-managed HTTP retain the version selected by initialize.
    extra.server.mcpServer.server.getNegotiatedProtocolVersion();

  // Protocol revisions are date strings. Do not forward arbitrary client-controlled text.
  return typeof version === 'string' && version.length === 10 && /^\d{4}-\d{2}-\d{2}$/.test(version)
    ? version
    : 'unknown';
}
