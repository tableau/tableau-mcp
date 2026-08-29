# Spec: Data-app `allowedOrigins` (declare + detect external fetch origins)

**Branch:** `compass/data-apps-allowed-origins`
**Status:** implemented (uncommitted working-tree changes on top of `compass/data-apps-dev`)
**Scope:** data-app authoring/validation flow only. No REST API, transport, or auth changes.

---

## 1. Problem

A published data app runs inside the Tableau viz-extension sandbox under a **strict
Content-Security-Policy**. The app can only `fetch`/XHR/WebSocket to origins the **package
manifest declares**; the monolith folds those declared origins into the served content's CSP
`default-src`. A request to an *undeclared* origin is blocked by the CSP, and — because the sandbox
has **no visible console** — the only symptom is whatever on-screen error the fetch's `catch`
renders. Authoring is also blind: a live query only runs after publish, so the author never sees the
block while building.

Two capabilities are needed:

1. **Declaration** — a way for the author (or the agent authoring on their behalf) to declare the
   external origins the app reaches, carried all the way into the published package manifest.
2. **Detection** — a safety net for the common case where the author writes a `fetch(...)` but
   forgets to declare its origin. This is especially likely when the request is *ambiguous* or
   arrives as a later incremental edit ("add a dropdown that pulls from my API at ABC.org").

This branch implements both: **Part A** (declaration plumbing) and **Part B** (a validate-time
advisory detector).

### Naming note

`allowedOrigins` is a slight misnomer. The value is really the set of origins the app **requests** —
the author must declare, up front, every external origin its code will reach. It does not *grant*
network access beyond what the CSP already allows; it *widens* the CSP to permit the origins listed.
A rename to `requestedOrigins` was considered (see §8) but not done — the package `manifest.json` key
is a contract with the monolith and must stay `allowedOrigins`.

---

## 2. Data flow

```
author intent
   │  scaffold-data-app        (allowedOrigins param, optional)
   │  upsert-data-app-files    (allowedOrigins param, optional)
   │  patch-data-app-file      (allowedOrigins param, optional)
   ▼
dataapp.json  (tool-managed manifest, key: "allowedOrigins")   ← single source of truth in workspace
   │  writeManifest()  (only sanctioned writer of the protected manifest)
   ▼
validate-workbook-package
   │  buildWorkspaceTwbx.readAllowedOrigins(snapshot)           ← reads the workspace manifest
   │  buildTwbx.renderManifest()                                 ← writes package Packages/<id>/manifest.json
   │  undeclaredOriginsCheck(files, allowedOrigins)              ← Part B: advisory scan
   ▼
package manifest.json  { id, version, name, author, allowedOrigins? }   ← contract with monolith
   │
   ▼
monolith prepends allowedOrigins to served-content CSP default-src   (PR #61836, out of this repo)
```

**Key insight — detection ≠ enforcement.** The CSP grant comes *solely* from Part A carrying the
declaration into the package manifest. Part B (the detector) only **warns**; it never adds an origin
and never gates the receipt.

---

## 3. Part A — declaration plumbing

### 3.1 Shared param + manifest writer — `manifestOrigins.ts` (new)

- **`allowedOriginsParam`** — the Zod schema shared by the write tools. `z.string().trim().max(2000).optional()`.
  Semantics:
  - **omitted** ⇒ leave the current setting unchanged;
  - **empty / whitespace** ⇒ clear it;
  - **non-empty** ⇒ set it (trimmed).
- **`updateManifestAllowedOrigins(store, scope, appId, allowedOrigins)`** — a narrow
  read-modify-write that changes **only** the `allowedOrigins` key of `dataapp.json`, preserving
  every other manifest field. Re-serializes through `buildDataAppManifest` (so the bytes stay
  identical to a scaffold's), then persists via `store.writeManifest(...)`. Callers pass this only
  when they intend to change the setting — an omitted param is handled by the caller (skip the call),
  never routed here.

### 3.2 Manifest key + byte-stability — `templates.ts`

- `DataAppManifest.allowedOrigins?: string` and `ScaffoldInput.allowedOrigins?: string` added.
- `DATA_APP_MANIFEST_SCHEMA_VERSION` is `2`.
- **`buildDataAppManifest`** emits `allowedOrigins` **last**, and **only** when trimmed-non-empty.
- **Byte-stability invariant:** an app that declares no origins produces a `dataapp.json` that is
  **byte-identical** to the pre-feature scaffold. This keeps existing golden/determinism tests valid
  and guarantees the feature is inert until used.

### 3.3 Tools that accept the param

- **`scaffold-data-app`** — optional `allowedOrigins` param, passed into `buildScaffoldFiles` at
  create time. (Whether to keep this on scaffold is an open question — see §8.)
- **`upsert-data-app-files`** — optional `allowedOrigins` param; when `!== undefined`, calls
  `updateManifestAllowedOrigins` after writing the files.
- **`patch-data-app-file`** — same, after applying the patch.

The intent is that an author declares an origin in the **same call** that writes the code that
fetches it — rather than editing a manifest they never see.

### 3.4 REPLACE-not-append semantics

The param **replaces** the entire allow-list; it does **not** append. When a later call adds a fetch
to a *new* origin, the caller must pass the **complete** set (the new origin *and* every origin
declared earlier), or the earlier ones are silently dropped and their fetches start failing at
runtime. This is documented in the param description and in the build-data-app skill.

### 3.5 Package manifest — `buildTwbx.ts` / `buildWorkspaceTwbx.ts`

- **`readAllowedOrigins(snapshot)`** (in `buildWorkspaceTwbx.ts`) reads the value from the workspace
  `dataapp.json`. It guards the type (`typeof manifest.allowedOrigins !== 'string' ⇒ undefined`) so a
  hand-edited/corrupted manifest degrades to "omit", never a `TypeError`. A blank/absent value yields
  `undefined`.
- **`renderManifest`** (in `buildTwbx.ts`) emits the package `manifest.json` as
  `{ id, version, name, author, allowedOrigins? }` — `allowedOrigins` present **only** when
  trimmed-non-empty, preserving the package's byte-stability for no-origins apps.

### 3.6 Round-trip recovery — `reconstructWorkspaceFromTwbx.ts`

`edit-data-app` reopens a published workbook by reconstructing the workspace from its `.twbx`.
Reconstruction recovers `allowedOrigins` from the package manifest and rebuilds `dataapp.json` via
`buildDataAppManifest`, so an **edit → republish** round trip does not silently drop a previously
declared allow-list.

### 3.7 Store sanctioned-writer — `workspaceStore.ts` / `fileSystemWorkspaceStore.ts`

`dataapp.json` is a **protected** workspace file: ordinary `upsertFiles` rejects it. A new
**`writeManifest(scope, appId, content)`** method is the *single sanctioned writer* of the manifest
after creation. Its implementation calls the internal batch validator with `allowProtected: true`,
scoped to the one fixed `dataapp.json` path (never a caller-selected path). This preserves the
store-layer constraint that `src/dataApps/` does not import from `src/tools/web/dataApps/`.

---

## 4. Part B — validate-time advisory detector (`undeclaredOriginsCheck`, new)

Chosen design: **C1 (validate-time)** + **Advisory (non-blocking)** severity. Runs inside
`validate-workbook-package`, the choke point every publish must pass through, against the **exact set
of files that will be packaged**.

### 4.1 What it does

Scans every packaged JS/HTML/CSS/JSON file for absolute `http(s)`/`ws(s)` URLs, reduces each to its
origin, and returns **one advisory warning per origin** the code requests but the manifest never
declared. Output is de-duplicated (one warning per unique origin, keyed to a sample referring file)
and sorted for deterministic output. **Never throws.**

The warnings land in `validateWorkbookPackage`'s `advisoryWarnings` bucket only — never in
`hardWarnings` (`referenceWarnings` + `sizeWarnings`).

### 4.2 Advisory-not-blocking contract

- The detector **cannot** flip `ok:false` and **cannot** suppress the `validationId`.
- On success the receipt is still issued; advisory warnings ride along in `warnings`.
- Rationale: a statically-built URL (`` `https://${host}/…` ``) can't be extracted, so the detector
  reduces the miss rate but does not eliminate it; and a bare code reference is not proof of a runtime
  fetch. Blocking on a best-effort heuristic would produce false failures.

### 4.3 Warn-not-auto-add rationale

The detector intentionally does **not** auto-add detected origins to `allowedOrigins`.
`allowedOrigins` gates a security boundary; a hallucinated or injected URL must never allowlist
itself. Detect and warn — a human / author agent decides whether to declare.

### 4.4 CSP-style matching semantics

An origin is "declared" if it matches any source in the space-separated `allowedOrigins` string.
Matching mirrors real CSP host-source semantics:

- **Bare `*`** — matches everything.
- **Scheme** — a source may omit the scheme (then any scheme matches). An `http`/`ws` source also
  covers its secure `https`/`wss` upgrade (CSP scheme-upgrade), so an insecure-scheme declaration does
  not spuriously flag a secure request.
- **Host** — exact match, or a leading `*.` wildcard that matches any **proper** subdomain
  (`length >`, so `*.example.com` does **not** match the bare apex `example.com`).
- **Port** — CSP host-source port rules, normalized the way `URL.origin` normalizes (it drops the
  scheme's default port):
  - a `*` port matches any;
  - an explicit port must match after normalizing the scheme's default (`:443` on https ≡ no port);
  - a source with **no** port matches **only** the scheme's default port — so a port-less
    `https://api.example.com` does **not** silently cover a `:8443` request the CSP would actually
    block.
- `DEFAULT_PORTS = { http:80, https:443, ws:80, wss:443 }` drives the normalization.
- A source that does not parse matches nothing — leaving the origin flagged (the safe default).

### 4.5 Noise controls

- **Scanned extensions:** `html htm js mjs cjs jsx ts tsx css json`. `.map` and binary assets are
  skipped.
- **Ignored namespace hosts:** `www.w3.org`, `www.opengis.net` — these appear as XML/SVG
  *namespace* identifiers (`createElementNS('http://www.w3.org/2000/svg', …)`), not fetch targets, and
  would otherwise fire on essentially every chart.
- **Plausible-hostname filter** drops fragments left by interpolated hosts
  (`https://api.` from `` `https://api.${env}.com` ``). The URL regex stops at template/expression
  boundaries, so `` `https://api.example.com/${id}` `` yields the static origin while
  `` `https://${host}/x` `` is dropped as a bogus host.
- Trailing prose punctuation is stripped so a URL that ends a sentence in a comment still parses.

### 4.6 Known best-effort limitations (accepted)

Confirmed acceptable by code review; left as-is:

- **Statically-unresolvable URLs are missed** — a fully runtime-built authority (interpolated host)
  can't be caught. This is why the check is advisory, not blocking.
- **Single-label hosts / IPv6 / protocol-relative (`//host`) URLs** are not detected.
- **Non-fetch URL noise** beyond the ignore-list may occasionally surface (e.g. a URL in a comment or
  a user-clicked link). The warning text explicitly tells the reader to ignore it when the reference
  isn't a runtime fetch.

---

## 5. Skill guidance — `buildDataApp.ts`

- **Step 4 (author)** teaches: declare every external origin the app fetches via the `allowedOrigins`
  param **in the same call** that writes the fetch; the param **replaces** the whole list, so pass the
  complete set each time; list only what the app needs; same-origin needs no declaration.
- **Step 5 (validate)** teaches the model to treat each advisory undeclared-origin warning as a prompt
  to declare that origin (re-passing the complete set) and re-validate — unless the reference genuinely
  isn't a runtime fetch. Advisories do not block the receipt, but an undeclared origin *will* be blocked
  by the published app's CSP.

---

## 6. Files changed

### New

| File | Purpose |
| --- | --- |
| `src/tools/web/dataApps/manifestOrigins.ts` | Shared `allowedOriginsParam` + `updateManifestAllowedOrigins` |
| `src/tools/web/dataApps/manifestOrigins.test.ts` | Tests for the above |
| `src/tools/web/validateWorkbookPackage/undeclaredOriginsCheck.ts` | Part B advisory detector |
| `src/tools/web/validateWorkbookPackage/undeclaredOriginsCheck.test.ts` | 23 tests for the detector |

### Modified

| File | Change |
| --- | --- |
| `src/tools/web/dataApps/templates.ts` | `allowedOrigins?` on manifest + scaffold input; emit-last/byte-stable |
| `src/tools/web/dataApps/scaffoldDataApp.ts` | optional `allowedOrigins` param → scaffold files |
| `src/tools/web/dataApps/upsertDataAppFiles.ts` | `allowedOrigins` param → `updateManifestAllowedOrigins` |
| `src/tools/web/dataApps/patchDataAppFile.ts` | `allowedOrigins` param → `updateManifestAllowedOrigins` |
| `src/tools/web/dataApps/workspaceStore.mock.ts` | `writeManifest` on the fake store |
| `src/dataApps/workspaceStore.ts` | `writeManifest` interface method |
| `src/dataApps/fileSystemWorkspaceStore.ts` | `writeManifest` impl (protected-path sanctioned writer) |
| `src/tools/web/createAndPublishWorkbook/buildWorkspaceTwbx.ts` | `readAllowedOrigins(snapshot)` → buildTwbx |
| `src/tools/web/createAndPublishWorkbook/buildTwbx.ts` | `renderManifest` emits `allowedOrigins?` |
| `src/tools/web/createAndPublishWorkbook/reconstructWorkspaceFromTwbx.ts` | recover `allowedOrigins` on reopen |
| `src/tools/web/validateWorkbookPackage/validateWorkbookPackage.ts` | run detector; advisory block; tool description |
| `src/resources/skills/buildDataApp.ts` | author + validate guidance |
| *(+ the `*.test.ts` for each of the above)* | coverage |

---

## 7. Testing

- Unit tests cover the detector's matching semantics (scheme upgrade, `*.` wildcard vs apex, port /
  default-port normalization, bare `*`, template-literal origin extraction, dynamic-host drop,
  namespace-host ignore, dedupe, sort, HTML/CSS/JSON scanning, binary skip, never-throws) and the
  Part A plumbing (manifest read/write, byte-stability, REPLACE semantics, round-trip recovery).
- `validateWorkbookPackage.test.ts` adds two integration tests: advisory-emitted (ok:true +
  validationId + warning for an undeclared origin) and silent-when-declared.
- Full suite green; lint clean.

---

## 8. Open questions (not implemented)

1. **Rename `allowedOrigins` → `requestedOrigins`** for the tool param, the internal `dataapp.json`
   key, and prose. The package `manifest.json` key must remain `allowedOrigins` (monolith contract).
2. **Drop the optional `allowedOrigins` param from `scaffold-data-app`** — since origins are usually
   discovered while authoring (upsert/patch), the scaffold-time param may be unnecessary.

Both are deferred pending confirmation.
