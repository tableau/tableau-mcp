import {
  CLIENT_CAPABILITIES_META_KEY,
  CLIENT_INFO_META_KEY,
  PROTOCOL_VERSION_META_KEY,
} from '@modelcontextprotocol/server';

import { log } from './logger.js';

export function logClientInitialized({
  protocolVersion,
  clientInfo,
  capabilities = {},
}: {
  protocolVersion: string | undefined;
  clientInfo: unknown;
  capabilities?: { elicitation?: unknown };
}): void {
  log({
    message: 'MCP client initialized',
    level: 'info',
    logger: 'http',
    data: {
      protocolVersion,
      clientInfo,
      capabilities,
      elicitationSupported: capabilities.elicitation !== undefined,
    },
  });
}

// Clients control these values, so the dedup set is capped; the oldest entry is evicted first.
const MAX_SEEN_CLIENTS = 1000;
const seenModernClients = new Set<string>();

// 2026-07-28 clients send no initialize: they carry version, client info and capabilities in each
// request's _meta. Log the first sighting of each distinct client, not every request.
export function logModernClientOnce(meta: Record<string, unknown> | undefined): void {
  try {
    const protocolVersion = meta?.[PROTOCOL_VERSION_META_KEY];
    const clientInfo = meta?.[CLIENT_INFO_META_KEY];
    const rawCapabilities = meta?.[CLIENT_CAPABILITIES_META_KEY];
    if (protocolVersion === undefined && clientInfo === undefined) return;

    const capabilities =
      rawCapabilities && typeof rawCapabilities === 'object'
        ? (rawCapabilities as { elicitation?: unknown })
        : {};
    const key = JSON.stringify([protocolVersion, clientInfo, stableStringify(capabilities)]);
    if (seenModernClients.has(key)) return;

    if (seenModernClients.size >= MAX_SEEN_CLIENTS) {
      seenModernClients.delete(seenModernClients.values().next().value!);
    }
    seenModernClients.add(key);

    logClientInitialized({
      protocolVersion: typeof protocolVersion === 'string' ? protocolVersion : undefined,
      clientInfo,
      capabilities,
    });
  } catch {
    // Logging must never affect request handling.
  }
}

// Key order must not change the dedup key.
function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)))
      : v,
  );
}
