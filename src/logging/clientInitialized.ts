import {
  CLIENT_CAPABILITIES_META_KEY,
  CLIENT_INFO_META_KEY,
  PROTOCOL_VERSION_META_KEY,
} from '@modelcontextprotocol/server';
import { createHash } from 'crypto';

import { log } from './logger.js';

type ClientSummary = {
  protocolVersion: string | undefined;
  clientInfo: { name: string | undefined; version: string | undefined };
  capabilities: Array<string>;
  extensions: Array<string>;
  elicitationSupported: boolean;
};

// Clients control these values, so only allowlisted fields are logged, each bounded in size.
const MAX_LOGGED_STRING_LENGTH = 200;
const MAX_LOGGED_KEYS = 20;

function truncate(value: unknown): string | undefined {
  return typeof value === 'string' ? value.slice(0, MAX_LOGGED_STRING_LENGTH) : undefined;
}

function keysOf(value: unknown): Array<string> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? Object.keys(value)
        .sort()
        .slice(0, MAX_LOGGED_KEYS)
        .map((key) => truncate(key)!)
    : [];
}

function summarizeClient({
  protocolVersion,
  clientInfo,
  capabilities,
}: {
  protocolVersion: unknown;
  clientInfo: unknown;
  capabilities?: unknown;
}): ClientSummary {
  const info =
    clientInfo && typeof clientInfo === 'object' ? (clientInfo as Record<string, unknown>) : {};
  const caps =
    capabilities && typeof capabilities === 'object'
      ? (capabilities as Record<string, unknown>)
      : {};
  return {
    protocolVersion: truncate(protocolVersion),
    clientInfo: { name: truncate(info.name), version: truncate(info.version) },
    capabilities: keysOf(caps),
    extensions: keysOf(caps.extensions),
    elicitationSupported: caps.elicitation !== undefined,
  };
}

function logSummary(summary: ClientSummary): void {
  log({ message: 'MCP client initialized', level: 'info', logger: 'http', data: summary });
}

export function logClientInitialized(client: {
  protocolVersion: string | undefined;
  clientInfo: unknown;
  capabilities?: unknown;
}): void {
  logSummary(summarizeClient(client));
}

// The dedup set is capped too; the oldest entry is evicted first.
const MAX_SEEN_CLIENTS = 1000;
const seenModernClients = new Set<string>();

// 2026-07-28 clients send no initialize: they carry version, client info and capabilities in each
// request's _meta. Log the first sighting of each distinct client, not every request.
export function logModernClientOnce(meta: Record<string, unknown> | undefined): void {
  try {
    const protocolVersion = meta?.[PROTOCOL_VERSION_META_KEY];
    const clientInfo = meta?.[CLIENT_INFO_META_KEY];
    if (protocolVersion === undefined && clientInfo === undefined) return;

    const summary = summarizeClient({
      protocolVersion,
      clientInfo,
      capabilities: meta?.[CLIENT_CAPABILITIES_META_KEY],
    });
    // Keyed on the logged summary, so varying an unlogged field doesn't log again.
    const key = createHash('sha256').update(JSON.stringify(summary)).digest('base64');
    if (seenModernClients.has(key)) return;

    if (seenModernClients.size >= MAX_SEEN_CLIENTS) {
      seenModernClients.delete(seenModernClients.values().next().value!);
    }
    seenModernClients.add(key);

    logSummary(summary);
  } catch {
    // Logging must never affect request handling.
  }
}
