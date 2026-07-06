# Authoring content pack — milestone-2 remote provider (Lane M6, design + skeleton)

Status: **design + skeleton only — NO network I/O.** This document defines the content-pack
contract and the caching/verification state machine that milestone 2 will run behind the existing
`AuthoringIntelligenceProvider` seam (`src/desktop/intelligence/provider.ts`). The real fetch
transport, the signing scheme, and the hosting endpoint are **deliberately not implemented here** —
they land once the hosting decision (maintainers — decision pending) exists. Everything in this lane is
exercised against in-memory fixtures.

## 1. Why a content pack

Adjudicated architecture (staged D→B):

- **Milestone 1 (DONE)** — a bundled in-package snapshot behind `AuthoringIntelligenceProvider`
  plus a generated `content-manifest.json`. Honest posture: `satisfies_exec_freshness: false` (a
  bundled snapshot is only as current as the last generator run).
- **Milestone 2 (this lane designs it)** — a versioned, signed **content pack** fetched remotely,
  served through the **same** `AuthoringIntelligenceProvider` interface, with the bundled snapshot as
  the offline fallback. Only a verified pack within its TTL satisfies the executive freshness
  requirement.

The interface does not change for callers (`list-templates`, `propose-template`, `validate-proposal`,
`bind-template`). They keep calling `getStatus()` / `getContentManifest()` / `listTemplateManifests()`
/ `getTemplateManifest()` / `getTemplateXmlFragment()`. Only the *source* behind the seam changes, and
`getStatus()` reports honestly which source is live.

## 2. What a content pack carries

A pack is a versioned bundle carrying exactly what `build/desktop/data` carries today (the resources
the `BundledIntelligenceProvider` serves), plus pack-level metadata and a detached signature.

### 2.1 Resources (identical set to the bundled snapshot)

- `template-manifests/<name>.manifest.json` — per-template binding contracts
- `template-manifests.index.json` — generated roll-up
- `template-manifests.fixture.json` — the schema fixture the eligibility gate binds against
- `data-visualization-templates-xml/<name>.xml` — shipped worksheet fragments (golden-only templates
  ship a manifest but no XML — same as today)

Note: the milestone-1 `content-manifest.json` becomes the pack **manifest** (§2.2). It is not itself a
hashed resource inside the pack (a manifest cannot hash itself); the signature covers it instead.

### 2.2 Pack manifest (the signed envelope)

```
PackManifest {
  pack_format_version: string    // envelope format; this lane defines "1"
  content_version:     string    // "<pkgVersion>+content.<YYYY-MM-DD>" (same shape as milestone 1)
  schema_version:      string    // CONTENT schema; integer-as-string; "1" today
  generated:           string    // YYYY-MM-DD
  engine_compat: { server_min: string; node: string }
  resources: Array<{ path: string; sha256: string /*64-hex*/; bytes: number /*>0*/ }>
}

SignedPackManifest {
  manifest:            PackManifest
  signature:           string     // detached signature over canonicalize(manifest)
  signature_algorithm: string     // OPEN QUESTION — scheme TBD (see §7)
}
```

`pack_format_version` (envelope) is intentionally distinct from `schema_version` (content shape). The
envelope can evolve (e.g. add a field to `SignedPackManifest`) independently of the content shape.
Both are gated (§4).

`canonicalize(manifest)` = deterministic JSON (recursively key-sorted, `undefined` dropped) so the
signed bytes are reproducible across producer/consumer. This is what the signature is computed over
and what the consumer re-derives to verify.

## 3. Version comparison

`compareVersions(a, b)` is a pure, dependency-free comparator (`semver` is **not** a direct dependency
of this package; do not add it — AGENTS.md forbids lockfile edits). It compares dot-separated numeric
components left-to-right, shorter-is-lower on a tie of shared components, and treats any non-numeric
tail (build metadata like `+content.2026-07-06`) as ignorable for ordering. It returns `-1 | 0 | 1`.

Used for: the engine-compat gate (§4) and, for the transport later, picking the newest available pack.

## 4. Compatibility rules (fail-closed gates)

The engine (this MCP server / binder) declares what it understands:

- `SUPPORTED_SCHEMA_VERSION` — the max **content** schema the engine can read (mirrors the generator's
  `SCHEMA_VERSION`, "1" today).
- `SUPPORTED_PACK_FORMAT_VERSION` — the max **envelope** format the engine can parse ("1").
- `engineVersion` — this build's version (`package.json` version), for the engine-compat range.

Gates, all fail-closed (a rejected pack is **never partially read** — it drops the whole pack to the
fallback ladder):

1. **Content schema gate.** A pack with `schema_version` **greater** than `SUPPORTED_SCHEMA_VERSION` is
   **REJECTED** (`schema-too-new`). The engine will not guess at a shape it does not understand.
   Equal-or-older is accepted (content shape evolves additively; the per-manifest validator still
   gates every manifest's shape on materialization).
2. **Pack-format gate.** `pack_format_version` greater than `SUPPORTED_PACK_FORMAT_VERSION` is
   **REJECTED** (`pack-format-too-new`).
3. **Engine-compat gate.** If `engineVersion < engine_compat.server_min` the engine is too old for the
   pack → **REJECTED** (`incompatible-engine`). `engine_compat.node` is advisory (recorded, surfaced
   in status) — the running Node version is already fixed by `engines` at install time.
4. **Signature gate.** The detached `signature` must verify against `canonicalize(manifest)` under an
   injected `SignatureVerifier`. Failure → **REJECTED** (`bad-signature`). See §7 (scheme is an open
   question; the interface + a test fake are defined, the scheme is not chosen).
5. **Integrity gate.** For every resource in `manifest.resources`, `sha256(bytes) === resource.sha256`
   and the resource is present; no declared resource may be missing. Any mismatch/missing →
   **REJECTED** (`tampered`). Resource paths are validated to be repo-relative with **no** `..`
   segment and no absolute/`~` prefix (path-traversal guard — a signed manifest is still untrusted
   input for path purposes).
6. **Well-formedness gate.** The manifest metadata itself must parse to the closed shape in §2.2
   (required fields, `sha256` is 64-hex, `bytes` a positive integer, `generated` is `YYYY-MM-DD`,
   `schema_version`/`pack_format_version` positive-integer strings). Anything else → **REJECTED**
   (`malformed`).

A pack that passes 1–6 is a `VerifiedPack`.

## 5. Freshness & the fallback ladder

`getStatus()` gains a `'remote-pack'` `kind`. `satisfies_exec_freshness` is `true` **only** when a
verified pack **within its TTL** is the active source.

TTL is measured from the pack's `fetched_at` (when it was written to cache) using an **injected clock**
(`now`) and a configured `ttlMs`. `now - fetched_at <= ttlMs` ⇒ fresh, else stale.

The fallback ladder, evaluated on **every load** (the cache is re-verified each time — a tampered cache
is caught late, not just at write):

1. **Verified fresh pack** → serve it. `kind: 'remote-pack'`, `freshness: 'remote-pack-fresh'`,
   `stale: false`, `satisfies_exec_freshness: true`.
2. **Verified stale pack** (past TTL but still passes every gate in §4) → serve it with an **honest
   stale flag**. `kind: 'remote-pack'`, `freshness: 'remote-pack-stale'`, `stale: true`,
   `satisfies_exec_freshness: false`, note says the content is past its freshness window.
3. **Bundled snapshot** → the offline fallback whenever no pack is servable (no cache, transport not
   configured, or the cached pack fails any gate — tampered/schema-too-new/incompatible/etc.).
   `kind: 'bundled'`, `freshness: 'bundled-snapshot'`, `satisfies_exec_freshness: false`, and a
   `fallback: <reason>` field naming *why* the remote path is not live. **Fail loud in status**: a
   tampered cache surfaces `fallback: 'tampered-cache'`, not a silent downgrade.

There is never a broken half-state: content is served either wholly from a verified pack or wholly from
the bundled snapshot. Materialization (parsing a verified pack's manifests/XML into the served maps) is
all-or-nothing; a pack that verifies but cannot materialize (a malformed inner manifest) drops to the
bundled snapshot (`fallback: 'malformed-pack'`).

### 5.1 `ProviderStatus` additions (backward compatible)

The milestone-1 `ProviderStatus` fields are unchanged. Milestone 2 widens the enums and adds two
**optional** fields:

- `kind: 'bundled' | 'remote-pack'` (was `'bundled'`)
- `freshness: 'bundled-snapshot' | 'remote-pack-fresh' | 'remote-pack-stale'` (was `'bundled-snapshot'`)
- `satisfies_exec_freshness: boolean` (was the literal `false`)
- `stale?: boolean` — remote-only; present when a pack is the active source
- `fallback?: RemoteFallbackReason` — remote-provider-only; present when it fell back to bundled

The bundled provider's runtime output is **byte-identical** to milestone 1: it sets neither optional
field (so JSON serialization is unchanged), and still returns `kind: 'bundled'`,
`freshness: 'bundled-snapshot'`, `satisfies_exec_freshness: false`.

## 6. Cache

- **Location.** A gitignored `cache/` directory already exists (used by the binder memo sidecar). The
  pack cache lives under `cache/authoring-content-pack/`. The concrete on-disk store is future work;
  this lane defines the `PackStore` interface (sync `read`/`write`/`clear`) and an `InMemoryPackStore`
  for dev/tests. Containment (all writes under the cache dir) is the security guardrail for the future
  filesystem store — same posture as the binder's `DesktopCache`.
- **Integrity re-check on every load.** `resolveActiveSource()` runs the full §4 verification against
  the cached bytes on each load, not only at fetch time. A cache tampered with after it was written is
  therefore caught and drops to the bundled fallback with a loud status.
- **State machine (pure).** `evaluateCachedPack(cached | null, deps) → CacheState` where
  `CacheState = { absent } | { fresh, pack } | { stale, pack } | { rejected, reason }`. Pure over an
  injected store snapshot + injected `now` — no I/O, fully fixture-testable.

## 7. Open questions (maintainers — decision pending)

1. **Signing scheme — UNDECIDED.** This lane does **not** pick or vendor a crypto scheme. It defines
   the `SignatureVerifier` interface (`verify({ payload, signature, algorithm }) → Result`) and a test
   fake, and records `signature_algorithm` as a manifest field. Candidates to adjudicate: detached
    minisign/ed25519 (small, offline-verifiable, key distribution simple) vs. an X.509/JWS chain (fits
   existing `jose` dependency, heavier key management) vs. Sigstore/cosign (keyless, needs network at
   verify time — conflicts with the offline-fallback requirement). Decision needed before a real
   verifier ships; until then the default `unconfiguredVerifier` rejects all signatures (so remote
   cannot serve and the engine safely stays on the bundled snapshot).
2. **Hosting endpoint — UNDECIDED.** Where packs and their manifests are hosted (CDN? Tableau-owned
   endpoint? GitHub release assets?) drives the `PackTransport` implementation (auth, retries, SSRF
   posture). This lane ships only `NotConfiguredTransport` (returns a typed `unavailable` result).
3. **TTL policy — PROPOSED DEFAULT 24h.** `AUTHORING_CONTENT_PACK_TTL_HOURS` (default 24). Confirm the
   freshness window the exec requirement implies, and whether stale-but-verified content should keep
   being served (current design: yes, with an honest `stale` flag) or hard-fail to bundled.
4. **Runtime adoption.** The factory (`getIntelligenceProvider`) is the single selection point but is
   **not yet wired into server startup** — the tools still import the bundled singleton directly, so the
   shipped default is provably unchanged. Wiring the factory in (and the real transport) is the
   milestone-2-final step, gated on #1/#2.

## 8. Config (opt-in; default bundled)

Parsed by `parseIntelligenceConfig(env)` (pure, fail-closed):

- `AUTHORING_CONTENT_PACK_MODE` ∈ `{ 'bundled', 'remote' }` — **closed enum**, default `'bundled'`.
  Absent or unrecognized ⇒ `'bundled'` (remote requires the explicit `'remote'` opt-in).
- `AUTHORING_CONTENT_PACK_TTL_HOURS` — positive number, default 24; invalid ⇒ default.

`getIntelligenceProvider(config, deps?)`:

- `mode: 'bundled'` (the default) returns the **exact** `bundledIntelligenceProvider` singleton →
  byte-identical to milestone 1.
- `mode: 'remote'` constructs a `RemotePackIntelligenceProvider` with injected
  `{ transport, verifier, store, clock, fallback, ttlMs, engine }`. With the shipped defaults
  (`NotConfiguredTransport`, `unconfiguredVerifier`, empty store) it resolves to the bundled snapshot
  with an honest `fallback` reason — still no behavior change for served content.

## 9. Skeleton module map

- `src/desktop/intelligence/contentPack.ts` — contract types, constants, `parsePackManifest`
  (watch-class boundary), `canonicalizePackManifest`, `compareVersions`, resource-path safety.
- `src/desktop/intelligence/packVerification.ts` — `SignatureVerifier` interface +
  `unconfiguredVerifier`, sha256 resource verification (node crypto), schema/pack-format/engine gates,
  `verifyPack` funnel.
- `src/desktop/intelligence/packCache.ts` — `PackStore` interface, `InMemoryPackStore`,
  `evaluateCachedPack` state machine.
- `src/desktop/intelligence/remoteProvider.ts` — `PackTransport` + `NotConfiguredTransport`, `Clock` +
  `systemClock`, pack materialization, `RemotePackIntelligenceProvider`.
- `src/desktop/intelligence/factory.ts` — `parseIntelligenceConfig` + `getIntelligenceProvider`.

## 10. Watch-class audit #5 — new boundaries

Every field crossing a trust boundary is a closed enum or a required, typed field, and fails closed:

- **Pack manifest metadata** (`parsePackManifest`): all §2.2 fields required and typed; `sha256`
  64-hex; `bytes` positive integer; `generated` `YYYY-MM-DD`; `schema_version` / `pack_format_version`
  positive-integer strings; resource `path` traversal-guarded. Missing/mistyped ⇒ `malformed`, whole
  pack rejected.
- **Signature** (`SignedPackManifest`): `signature` and `signature_algorithm` required non-empty
  strings; verification is a hard gate.
- **Compat gates**: `schema_version` / `pack_format_version` / `engine_compat.server_min` are all hard,
  fail-closed comparisons — newer-than-understood is rejected, not partially read.
- **Config** (`parseIntelligenceConfig`): `AUTHORING_CONTENT_PACK_MODE` closed enum, default bundled;
  remote is opt-in only.
- **`getStatus()` honesty**: `satisfies_exec_freshness` is `true` on exactly one state (verified fresh
  pack); every fallback names its reason.
