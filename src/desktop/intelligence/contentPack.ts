// src/desktop/intelligence/contentPack.ts
//
// Content-pack CONTRACT (Lane M6 milestone-2 skeleton — NO network I/O).
// The pack is the versioned, signed envelope that carries what `build/desktop/data`
// carries today plus pack-level metadata (see docs/authoring-content-pack.md §2).
//
// This module is the lowest layer: contract types, engine-support constants, the
// watch-class boundary parser for untrusted pack metadata, a dependency-free version
// comparator, resource-path safety, and canonicalization (the bytes a signature
// covers). No I/O, no crypto — pure functions over already-parsed values.

import path from 'path';
import { Err, Ok, type Result } from 'ts-results-es';

import type { ContentManifest, ContentResource, EngineCompat } from './provider.js';

/**
 * The max CONTENT schema this engine understands. Mirrors the generator's
 * `SCHEMA_VERSION` (src/scripts/buildTemplateManifests.ts). A pack whose
 * `schema_version` exceeds this is rejected wholesale — never partially read.
 */
export const SUPPORTED_SCHEMA_VERSION = '2';

/**
 * The max pack ENVELOPE format this engine can parse. Distinct from the content
 * `schema_version` so the envelope can evolve independently. A pack whose
 * `pack_format_version` exceeds this is rejected.
 */
export const SUPPORTED_PACK_FORMAT_VERSION = '1';

/** The signed pack manifest: the milestone-1 content manifest + an envelope-format version. */
export interface PackManifest extends ContentManifest {
  pack_format_version: string;
}

/** A pack manifest plus its detached signature (the scheme is an OPEN question — see §7). */
export interface SignedPackManifest {
  manifest: PackManifest;
  /** Detached signature over `canonicalizePackManifest(manifest)`. */
  signature: string;
  /** The signing scheme identifier. Non-empty; the concrete scheme is TBD (maintainers — decision pending). */
  signature_algorithm: string;
}

/**
 * Compare two dot-separated numeric versions, ignoring any build/pre-release tail
 * (`+content.2026-07-06`, `-rc1`). Returns -1 | 0 | 1. Dependency-free on purpose:
 * `semver` is NOT a direct dependency of this package (AGENTS.md forbids adding one).
 */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const parse = (v: string): number[] =>
    v
      .split('+')[0]
      .split('-')[0]
      .split('.')
      .map((p) => {
        const n = parseInt(p, 10);
        return Number.isNaN(n) ? 0 : n;
      });
  const pa = parse(a);
  const pb = parse(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x < y) return -1;
    if (x > y) return 1;
  }
  return 0;
}

/**
 * A resource path from a pack manifest is untrusted input for filesystem purposes
 * even inside a signed manifest. Safe = non-empty, repo-relative, no `..` segment,
 * not absolute, not `~`-prefixed. (Materialization uses these to key served content;
 * a future filesystem store uses them to write under the cache dir.)
 */
export function isResourcePathSafe(p: unknown): p is string {
  if (typeof p !== 'string' || p.length === 0) return false;
  if (path.isAbsolute(p)) return false;
  if (p.startsWith('~')) return false;
  const segments = p.split('\\').join('/').split('/');
  return !segments.some((s) => s === '..');
}

const SHA256_RE = /^[0-9a-f]{64}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const INT_RE = /^\d+$/;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

function validateResource(r: unknown, i: number, errors: string[]): void {
  const where = `resources[${i}]`;
  if (!isRecord(r)) {
    errors.push(`${where}: not an object`);
    return;
  }
  if (!isResourcePathSafe(r.path)) {
    errors.push(`${where}.path '${String(r.path)}' must be a safe repo-relative path`);
  }
  if (typeof r.sha256 !== 'string' || !SHA256_RE.test(r.sha256)) {
    errors.push(`${where}.sha256 '${String(r.sha256)}' must be a 64-char lowercase hex string`);
  }
  if (typeof r.bytes !== 'number' || !Number.isInteger(r.bytes) || r.bytes <= 0) {
    errors.push(`${where}.bytes must be a positive integer`);
  }
}

function validateEngineCompat(ec: unknown, errors: string[]): void {
  if (!isRecord(ec)) {
    errors.push('engine_compat must be an object { server_min, node }');
    return;
  }
  if (!isNonEmptyString(ec.server_min)) {
    errors.push('engine_compat.server_min must be a non-empty string');
  }
  if (!isNonEmptyString(ec.node)) {
    errors.push('engine_compat.node must be a non-empty string');
  }
}

/**
 * Parse & validate untrusted pack-manifest metadata into the closed `PackManifest`
 * shape (watch-class boundary #5). Returns the error list on ANY violation — a
 * malformed manifest fails closed (the caller drops the whole pack to the fallback
 * ladder). Extra unknown keys are ignored (forward-compatible) but every REQUIRED
 * field must be present and correctly typed.
 */
export function parsePackManifest(raw: unknown): Result<PackManifest, string[]> {
  const errors: string[] = [];
  if (!isRecord(raw)) {
    return new Err(['pack manifest is not an object']);
  }
  if (typeof raw.pack_format_version !== 'string' || !INT_RE.test(raw.pack_format_version)) {
    errors.push('pack_format_version must be a positive-integer string');
  }
  if (!isNonEmptyString(raw.content_version)) {
    errors.push('content_version must be a non-empty string');
  }
  if (typeof raw.schema_version !== 'string' || !INT_RE.test(raw.schema_version)) {
    errors.push('schema_version must be a positive-integer string');
  }
  if (typeof raw.generated !== 'string' || !DATE_RE.test(raw.generated)) {
    errors.push('generated must be a YYYY-MM-DD string');
  }
  validateEngineCompat(raw.engine_compat, errors);
  if (!Array.isArray(raw.resources) || raw.resources.length === 0) {
    errors.push('resources must be a non-empty array');
  } else {
    raw.resources.forEach((r, i) => validateResource(r, i, errors));
  }
  if (errors.length > 0) return new Err(errors);

  const ec = raw.engine_compat as Record<string, unknown>;
  const manifest: PackManifest = {
    pack_format_version: raw.pack_format_version as string,
    content_version: raw.content_version as string,
    schema_version: raw.schema_version as string,
    generated: raw.generated as string,
    engine_compat: { server_min: ec.server_min as string, node: ec.node as string },
    resources: (raw.resources as unknown[]).map((r) => {
      const rr = r as Record<string, unknown>;
      return { path: rr.path as string, sha256: rr.sha256 as string, bytes: rr.bytes as number };
    }),
  };
  return new Ok(manifest);
}

/** Parse & validate the signed envelope (manifest + non-empty signature + algorithm). */
export function parseSignedPackManifest(raw: unknown): Result<SignedPackManifest, string[]> {
  if (!isRecord(raw)) {
    return new Err(['signed pack manifest is not an object']);
  }
  const errors: string[] = [];
  if (!isNonEmptyString(raw.signature)) {
    errors.push('signature must be a non-empty string');
  }
  if (!isNonEmptyString(raw.signature_algorithm)) {
    errors.push('signature_algorithm must be a non-empty string');
  }
  const manifestResult = parsePackManifest(raw.manifest);
  if (manifestResult.isErr()) {
    errors.push(...manifestResult.error.map((e) => `manifest.${e}`));
  }
  if (errors.length > 0) return new Err(errors);
  return new Ok({
    manifest: manifestResult.unwrap(),
    signature: raw.signature as string,
    signature_algorithm: raw.signature_algorithm as string,
  });
}

/**
 * Deterministic canonicalization: recursively key-sorted JSON with `undefined`
 * dropped. This is the byte sequence a signature is computed over AND re-derived to
 * verify, so producer and consumer agree independent of key insertion order.
 */
export function canonicalizePackManifest(manifest: PackManifest): string {
  return JSON.stringify(sortDeep(manifest));
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

export type { ContentManifest, ContentResource, EngineCompat };
