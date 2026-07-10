// src/desktop/intelligence/factory.ts
//
// SELECTION wiring for the authoring intelligence provider (Lane M6 milestone-2
// skeleton). Picks bundled vs remote by config; default is bundled and remote requires
// an EXPLICIT opt-in (fail-closed). The default path returns the EXACT
// `bundledIntelligenceProvider` singleton, so the shipped behavior is byte-identical to
// milestone 1.
//
// NOT YET wired into server startup (docs §7 open question #4): the tools still import
// the bundled singleton directly. Wiring this factory in — and the real transport —
// is the milestone-2-final step, gated on the signing-scheme + hosting decisions.

import { SUPPORTED_PACK_FORMAT_VERSION, SUPPORTED_SCHEMA_VERSION } from './contentPack.js';
import { InMemoryPackStore, type PackStore } from './packCache.js';
import {
  type EngineInfo,
  type SignatureVerifier,
  unconfiguredVerifier,
} from './packVerification.js';
import { type AuthoringIntelligenceProvider, bundledIntelligenceProvider } from './provider.js';
import {
  type Clock,
  NotConfiguredTransport,
  type PackTransport,
  RemotePackIntelligenceProvider,
  systemClock,
} from './remoteProvider.js';

/** How the intelligence layer sources content. Closed enum; default bundled. */
export type IntelligenceMode = 'bundled' | 'remote';

/** Parsed intelligence config (pure, fail-closed). */
export interface IntelligenceConfig {
  mode: IntelligenceMode;
  ttlMs: number;
  /** Present (honestly recorded) when an unrecognized mode string was supplied. */
  invalidMode?: string;
}

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Parse the intelligence config from an env-like record (watch-class boundary #5).
 * `AUTHORING_CONTENT_PACK_MODE` is a closed enum — only the exact `'remote'` opts in;
 * anything else (including case variants) fails closed to `'bundled'` and is recorded
 * in `invalidMode`. `AUTHORING_CONTENT_PACK_TTL_HOURS` must be a positive number, else
 * the default is used.
 */
export function parseIntelligenceConfig(
  env: Record<string, string | undefined>,
): IntelligenceConfig {
  const rawMode = env.AUTHORING_CONTENT_PACK_MODE;
  let mode: IntelligenceMode = 'bundled';
  let invalidMode: string | undefined;
  if (rawMode === 'remote' || rawMode === 'bundled') {
    mode = rawMode;
  } else if (rawMode !== undefined) {
    invalidMode = rawMode;
  }

  let ttlMs = DEFAULT_TTL_MS;
  const rawTtl = env.AUTHORING_CONTENT_PACK_TTL_HOURS;
  if (rawTtl !== undefined) {
    const hours = Number(rawTtl);
    if (Number.isFinite(hours) && hours > 0) {
      ttlMs = hours * 60 * 60 * 1000;
    }
  }

  return invalidMode === undefined ? { mode, ttlMs } : { mode, ttlMs, invalidMode };
}

/** Optional injected seams for the remote provider (all default to the safe, no-network shipped values). */
export interface IntelligenceProviderDeps {
  transport?: PackTransport;
  verifier?: SignatureVerifier;
  store?: PackStore;
  clock?: Clock;
  fallback?: AuthoringIntelligenceProvider;
  engine?: EngineInfo;
}

/**
 * Default engine info, derived from the bundled snapshot's content manifest (its
 * package version) + the engine's supported schema/pack-format constants.
 */
function defaultEngineInfo(): EngineInfo {
  const s = bundledIntelligenceProvider.getStatus();
  return {
    version: s.content_version.split('+')[0],
    supportedSchemaVersion: SUPPORTED_SCHEMA_VERSION,
    supportedPackFormatVersion: SUPPORTED_PACK_FORMAT_VERSION,
  };
}

/**
 * Select the active intelligence provider. `bundled` (the default) returns the EXACT
 * shared singleton — byte-identical to milestone 1. `remote` constructs a
 * `RemotePackIntelligenceProvider`; with the shipped defaults (no transport, no
 * verifier, empty store) it resolves to the bundled snapshot with an honest fallback
 * reason, so served content is still unchanged.
 */
export function getIntelligenceProvider(
  config: IntelligenceConfig,
  deps: IntelligenceProviderDeps = {},
): AuthoringIntelligenceProvider {
  if (config.mode === 'bundled') {
    return bundledIntelligenceProvider;
  }
  return new RemotePackIntelligenceProvider({
    transport: deps.transport ?? new NotConfiguredTransport(),
    verifier: deps.verifier ?? unconfiguredVerifier,
    store: deps.store ?? new InMemoryPackStore(),
    clock: deps.clock ?? systemClock,
    fallback: deps.fallback ?? bundledIntelligenceProvider,
    engine: deps.engine ?? defaultEngineInfo(),
    ttlMs: config.ttlMs,
  });
}
