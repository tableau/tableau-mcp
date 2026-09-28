import { ClientCapabilities } from '@modelcontextprotocol/sdk/types.js';

/**
 * `ClientCapabilities` widened with the `extensions` field where a client advertises MCP Apps
 * support during the `initialize` handshake (`extensions["io.modelcontextprotocol/ui"]`). The
 * SDK's `ClientCapabilities` does not yet model `extensions` (pending SEP-1724); once it does,
 * this alias can collapse to `ClientCapabilities` directly.
 */
export type ClientCapabilitiesWithUiExtension = ClientCapabilities & {
  extensions?: Record<string, unknown>;
};
