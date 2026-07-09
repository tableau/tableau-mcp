// src/desktop/intelligence/packCache.ts
//
// Content-pack CACHE state machine (Lane M6 milestone-2 skeleton — NO network I/O).
// The store is an injected, synchronous key/value seam; `evaluateCachedPack` is a PURE
// function over a store snapshot + an injected clock. Integrity is re-checked on every
// evaluation (the cache is untrusted between writes), so a tampered cache is `rejected`,
// NEVER `stale` — integrity beats TTL (docs/authoring-content-pack.md §5, §6).

import {
  type CachedPack,
  type EngineInfo,
  type PackRejectionReason,
  type SignatureVerifier,
  type VerifiedPack,
  verifyPack,
} from './packVerification.js';

/**
 * Synchronous pack store seam. The default filesystem implementation (under the
 * gitignored `cache/authoring-content-pack/`) is future work; this lane ships the
 * interface + an in-memory store for dev/tests.
 */
export interface PackStore {
  read(): CachedPack | null;
  write(pack: CachedPack): void;
  clear(): void;
}

/** In-memory pack store (dev/tests). Holds at most one pack. */
export class InMemoryPackStore implements PackStore {
  private pack: CachedPack | null = null;

  constructor(initial: CachedPack | null = null) {
    this.pack = initial;
  }

  read(): CachedPack | null {
    return this.pack;
  }

  write(pack: CachedPack): void {
    this.pack = pack;
  }

  clear(): void {
    this.pack = null;
  }
}

/**
 * Allowance for benign clock disagreement between the cache-writer's clock and the
 * evaluation clock. A `fetched_at` up to this far into the FUTURE is tolerated (treated
 * as age 0); beyond it, the timestamp cannot be a legitimately-written cache stamp and
 * is rejected as `tampered` (a forged-future stamp must not confer freshness forever).
 */
export const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000; // 5 minutes

/** The evaluated state of the cache. Exactly one of these describes any load. */
export type CacheState =
  | { state: 'absent' }
  | { state: 'fresh'; pack: VerifiedPack }
  | { state: 'stale'; pack: VerifiedPack }
  | { state: 'rejected'; reason: PackRejectionReason; detail: string };

/**
 * Pure evaluation of a cached pack:
 *   - no cache                       → absent
 *   - fails ANY §4 gate              → rejected (integrity/compat beats TTL — a tampered
 *                                      pack is never served, never "stale")
 *   - fetched_at in the FUTURE beyond → rejected 'tampered' (a legitimately-written cache
 *     MAX_CLOCK_SKEW_MS               timestamp cannot be meaningfully in the future;
 *                                      forging it forward would otherwise give a negative
 *                                      age → `fresh` forever — integrity beats TTL)
 *   - fetched_at in the future WITHIN → age clamped to 0 → fresh (benign clock skew)
 *     MAX_CLOCK_SKEW_MS (inclusive)
 *   - verified & in TTL              → fresh  (now - fetchedAt <= ttlMs, inclusive)
 *   - verified & past TTL            → stale
 */
export function evaluateCachedPack(
  cached: CachedPack | null,
  deps: { now: Date; ttlMs: number; verifier: SignatureVerifier; engine: EngineInfo },
): CacheState {
  if (cached === null) {
    return { state: 'absent' };
  }
  const verified = verifyPack(cached, { verifier: deps.verifier, engine: deps.engine });
  if (verified.isErr()) {
    return { state: 'rejected', reason: verified.error.reason, detail: verified.error.detail };
  }
  const pack = verified.value;
  const ageMs = deps.now.getTime() - pack.fetchedAt.getTime();
  // A future-dated fetched_at beyond the skew allowance is integrity-suspect, not fresh.
  if (ageMs < -MAX_CLOCK_SKEW_MS) {
    return {
      state: 'rejected',
      reason: 'tampered',
      detail: `fetched_at ${pack.fetchedAt.toISOString()} is ${-ageMs}ms in the future (> ${MAX_CLOCK_SKEW_MS}ms skew)`,
    };
  }
  // Within-skew future → treat as age 0 (fresh); otherwise the real elapsed age.
  const effectiveAgeMs = Math.max(0, ageMs);
  return effectiveAgeMs <= deps.ttlMs ? { state: 'fresh', pack } : { state: 'stale', pack };
}
