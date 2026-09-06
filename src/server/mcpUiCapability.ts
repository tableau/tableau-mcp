import { getUiCapability, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
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

/**
 * Whether the connecting client advertised that it can render MCP Apps. Reads the SEP-1724 UI
 * capability via ext-apps' `getUiCapability` and requires the MCP Apps MIME type to be present.
 * Returns `false` when capabilities are missing or the UI extension is absent — the safe default
 * that falls back to plain (non-app) tool registration.
 */
export function clientSupportsMcpApps(
  capabilities: ClientCapabilitiesWithUiExtension | undefined,
): boolean {
  const uiCap = getUiCapability(capabilities);
  return uiCap?.mimeTypes?.includes(RESOURCE_MIME_TYPE) ?? false;
}
