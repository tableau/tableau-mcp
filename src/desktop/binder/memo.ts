// src/binder/memo.ts
//
// Binder MEMOIZATION — "anything the system has seen once is seconds forever."
//
// Two content-addressed caches, both invalidated ONLY by a content-hash change
// (never time-based):
//
//   1. SCHEMA CACHE — memoizes `summarizeSchema(workbookXml)` keyed by the
//      sha256 of the raw workbook XML (the datasource-schema source). An optional
//      JSON sidecar under the gitignored `cache/` directory survives process
//      restarts. `summarizeSchema` is the single most expensive deterministic step
//      on the bind hot-path (it parses XML via listAvailableFields), so caching it
//      turns every repeat schema into an O(1) lookup.
//
//   2. BIND MEMO — memoizes the deterministic leg of `bindTemplate` keyed by
//      (schemaHash, manifestHash, minConfidence, normalizedAsk). A no-LLM classify
//      HIT returns the cached InjectTemplateArgs instantly; a bound result produced
//      by the propose leg (agent Call-2 proposal or the eval-only injected
//      llmPropose) is cached ONLY AFTER `validateBinding` passes (we cache VALIDATED
//      results, never raw LLM output). `propose` and `escalate` outcomes are never
//      cached — so a plain Call-1 that must escalate/propose always recomputes and
//      the memo can never turn a would-be propose into a wrong bound.
//
// KEY COMPOSITION (exact):
//   schemaHash    = sha256(stableStringify(SchemaSummary))     // content of the derived summary
//   manifestHash  = sha256(stableStringify(sorted manifest entries))  // every manifest's full content
//   normalizedAsk = ask.trim().replace(/\s+/g," ")             // whitespace-only normalization; CASE PRESERVED
//   key           = [schemaHash, manifestHash, String(minConfidence), normalizedAsk].join("\u0000")
//
// The whole bind result is a pure function of (ask, SchemaSummary, manifests,
// proposal, minConfidence) — `bindTemplate` reads the workbook XML ONLY through
// `summarizeSchema`, then everything downstream consumes the summary — so a key
// built from the summary content + the full manifest content + the normalized ask
// fully determines the deterministic result. That is why memoization can never
// change a result: identical keys ⇒ identical inputs ⇒ identical output.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import {
  type BinderResult,
  type BindingProposal,
  bindTemplate,
  type LlmProposeFn,
  type SchemaSummary,
  summarizeSchema,
} from './binder.js';
import type { TemplateManifest } from './manifest-types.js';

// PORT ADAPTATION (source ESM → tableau-mcp CommonJS): the source resolved this from
// `fileURLToPath(import.meta.url)`, which is unavailable under the target's
// `type: commonjs` + esbuild bundle (and would require a banned `@ts-expect-error`).
// The sidecar is OPT-IN (default OFF — see getDefaultSchemaCache), so this constant is
// never touched by the hermetic in-memory default; it resolves from `process.cwd()`
// to match manifest.ts's DATA_DIR idiom if a caller ever enables persistence.
/** Default (opt-in) sidecar path for the schema cache. `cache/` is gitignored. */
export const DEFAULT_SCHEMA_SIDECAR_PATH = path.join(
  process.cwd(),
  'cache',
  'binder',
  'schema-cache.json',
);

/** Mirror of `bindTemplate`'s DEFAULT_MIN_CONFIDENCE (kept in sync; only affects key bucketing). */
const DEFAULT_MIN_CONFIDENCE = 0.6;

/** The key-part separator: a NUL byte, which cannot appear in any component. */
const SEP = '\u0000';

// ── Stable, content-addressed hashing ──────────────────────────────────────

/**
 * Deterministic JSON: object keys sorted recursively so key ORDER never affects
 * the string, while array order is preserved (it is semantically meaningful).
 * `undefined` is dropped (matches JSON semantics), functions are not expected.
 */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortDeep(value));
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      const v = (value as Record<string, unknown>)[k];
      if (v !== undefined) out[k] = sortDeep(v);
    }
    return out;
  }
  return value;
}

/** sha256 of a string as lowercase hex. */
export function sha256Hex(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

/** Content hash of a derived SchemaSummary (stable-stringify → sha256). */
export function hashSchemaSummary(summary: SchemaSummary): string {
  return sha256Hex(stableStringify(summary));
}

/**
 * Content hash of the ENTIRE manifest set — every manifest's full content, sorted
 * by template name so map insertion order is irrelevant. The in-memory
 * `Map<string,TemplateManifest>` carries the same full per-template content that
 * `data/template-manifests.index.json` serializes (its `templates[]` entries hold
 * slots/calcs/portability_evidence/avoid_when/hazards), so hashing the map
 * incorporates every manifest file's content.
 */
export function hashManifests(manifests: Map<string, TemplateManifest>): string {
  const entries = [...manifests.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return sha256Hex(stableStringify(entries.map(([k, v]) => [k, v])));
}

/**
 * Normalize an ask for the bind key. Whitespace-only normalization (trim +
 * collapse internal runs) — SAFE because `makeTitle` itself trims/collapses and
 * classification is whitespace-insensitive, so two asks differing only in
 * whitespace produce an identical result (title included). CASE IS PRESERVED
 * because the emitted title preserves case, so lowercasing would change results.
 */
export function normalizeAsk(ask: string): string {
  return ask.trim().replace(/\s+/g, ' ');
}

// ── JSON deep clone (BinderResult is plain JSON) ───────────────────────────
function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

// ── Schema cache ────────────────────────────────────────────────────────────

export interface SchemaCacheStats {
  hits: number;
  misses: number;
  size: number;
}

interface SchemaSidecar {
  version: 1;
  entries: Record<string, SchemaSummary>;
}

/**
 * Content-addressed memo for `summarizeSchema`. Keyed by sha256(workbookXml) —
 * the raw schema source. Optional JSON sidecar (default off) persists entries
 * under the gitignored `cache/` directory so a warm schema survives restarts.
 */
export class SchemaCache {
  private map = new Map<string, SchemaSummary>();
  private sidecarPath?: string;
  readonly stats: SchemaCacheStats = { hits: 0, misses: 0, size: 0 };

  constructor(opts: { sidecarPath?: string } = {}) {
    this.sidecarPath = opts.sidecarPath;
    if (this.sidecarPath) this.load();
  }

  /** Peek without computing. */
  get(workbookXml: string): SchemaSummary | undefined {
    return this.map.get(sha256Hex(workbookXml));
  }

  /**
   * Return the summary for `workbookXml`, computing + caching on a miss. `hash`
   * is the raw-XML content hash used as the cache key; `hit` reports whether the
   * value was served from cache.
   */
  getOrCompute(workbookXml: string): { summary: SchemaSummary; hash: string; hit: boolean } {
    const hash = sha256Hex(workbookXml);
    const cached = this.map.get(hash);
    if (cached) {
      this.stats.hits++;
      return { summary: cached, hash, hit: true };
    }
    this.stats.misses++;
    const summary = summarizeSchema(workbookXml);
    this.map.set(hash, summary);
    this.stats.size = this.map.size;
    if (this.sidecarPath) this.persist();
    return { summary, hash, hit: false };
  }

  clear(): void {
    this.map.clear();
    this.stats.size = 0;
  }

  private load(): void {
    try {
      if (!this.sidecarPath || !fs.existsSync(this.sidecarPath)) return;
      const parsed = JSON.parse(fs.readFileSync(this.sidecarPath, 'utf8')) as SchemaSidecar;
      if (parsed && parsed.version === 1 && parsed.entries) {
        for (const [k, v] of Object.entries(parsed.entries)) this.map.set(k, v);
        this.stats.size = this.map.size;
      }
    } catch {
      // A corrupt/unreadable sidecar is non-fatal — treat as a cold cache.
    }
  }

  private persist(): void {
    if (!this.sidecarPath) return;
    try {
      fs.mkdirSync(path.dirname(this.sidecarPath), { recursive: true });
      const payload: SchemaSidecar = { version: 1, entries: Object.fromEntries(this.map) };
      fs.writeFileSync(this.sidecarPath, JSON.stringify(payload));
    } catch {
      // Persistence is best-effort; the in-memory cache remains authoritative.
    }
  }
}

// ── Memoized binder ──────────────────────────────────────────────────────────

export interface CacheTelemetry {
  /** true ⇒ this result was served from the bind memo (no classify / no LLM). */
  hit: boolean;
  /** The composite key this bind resolved to (schemaHash·manifestHash·minConf·ask). */
  key: string;
}

/** A `BinderResult` plus cache-hit telemetry so evals can report warm vs cold. */
export type MemoBinderResult = BinderResult & { cache: CacheTelemetry };

export interface BindArgs {
  ask: string;
  workbookXml: string;
  manifests: Map<string, TemplateManifest>;
  proposal?: BindingProposal;
  llmPropose?: LlmProposeFn;
  minConfidence?: number;
}

export interface BindMemoStats {
  hits: number;
  misses: number;
  size: number;
}

export interface MemoizedBinder {
  /** Bind, consulting/populating the memo. Adds `cache:{hit,key}` telemetry. */
  bind(args: BindArgs): Promise<MemoBinderResult>;
  /** Compute the composite key + its parts for a request (no bind). */
  keyFor(args: BindArgs): {
    key: string;
    schemaHash: string;
    manifestHash: string;
    normalizedAsk: string;
  };
  readonly schemaCache: SchemaCache;
  readonly stats: BindMemoStats;
  clear(): void;
}

export interface MemoizedBinderOptions {
  /** Share a schema cache with prewarm/other binders. Defaults to a private one. */
  schemaCache?: SchemaCache;
}

/**
 * Create a memoized wrapper over `bindTemplate`. Purely additive — the underlying
 * `bindTemplate` is unchanged, so an adopter can swap this in without behavioral
 * risk. Results are deep-cloned on both store and hit so a caller mutating the
 * returned args can never corrupt a cached entry.
 */
export function createMemoizedBinder(opts: MemoizedBinderOptions = {}): MemoizedBinder {
  const schemaCache = opts.schemaCache ?? new SchemaCache();
  const store = new Map<string, BinderResult>();
  const stats: BindMemoStats = { hits: 0, misses: 0, size: 0 };

  function keyFor(args: BindArgs): {
    key: string;
    schemaHash: string;
    manifestHash: string;
    normalizedAsk: string;
  } {
    const { summary } = schemaCache.getOrCompute(args.workbookXml);
    const schemaHash = hashSchemaSummary(summary);
    const manifestHash = hashManifests(args.manifests);
    const minConf = args.minConfidence ?? DEFAULT_MIN_CONFIDENCE;
    const normalizedAsk = normalizeAsk(args.ask);
    const key = [schemaHash, manifestHash, String(minConf), normalizedAsk].join(SEP);
    return { key, schemaHash, manifestHash, normalizedAsk };
  }

  async function bind(args: BindArgs): Promise<MemoBinderResult> {
    const { key } = keyFor(args);

    // READ: only for Call-1-shaped requests (no explicit proposal to validate).
    // A cached entry is always a VALIDATED bound result, so serving it is safe.
    if (!args.proposal) {
      const cached = store.get(key);
      if (cached) {
        stats.hits++;
        return { ...clone(cached), cache: { hit: true, key } };
      }
    }

    stats.misses++;
    const result = await bindTemplate(args);
    // WRITE: cache VALIDATED bound results only (from any leg). Never cache
    // `propose` (a would-be miss) or `escalate` (proposal-dependent failure).
    if (result.status === 'bound') {
      store.set(key, clone(result));
      stats.size = store.size;
    }
    return { ...result, cache: { hit: false, key } };
  }

  return {
    bind,
    keyFor,
    schemaCache,
    stats,
    clear() {
      store.clear();
      stats.size = 0;
    },
  };
}

/**
 * Process-wide default schema cache. Shared by the default prewarm path so a
 * prewarmed datasource makes the first real ask a warm schema lookup. In-memory
 * only by default (no sidecar) to keep tests hermetic; a server can construct its
 * own `SchemaCache({ sidecarPath: DEFAULT_SCHEMA_SIDECAR_PATH })` to persist.
 */
let _defaultSchemaCache: SchemaCache | null = null;
export function getDefaultSchemaCache(): SchemaCache {
  if (!_defaultSchemaCache) _defaultSchemaCache = new SchemaCache();
  return _defaultSchemaCache;
}
