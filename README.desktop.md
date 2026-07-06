# Tableau Desktop Authoring MCP

The **desktop** build variant of `@tableau/mcp-server`. Where the default variant talks to
Tableau Cloud/Server over REST, this variant exposes a **local authoring** tool surface that
drives a running **Tableau Desktop** instance — inspect a workbook, list/inject chart
templates, and bind fields into worksheets — over MCP (stdio).

This document is a from-source quickstart. The desktop variant is **not** yet built by the
publish pipeline (see [Known gaps](#known-gaps)); build it from a clone.

## The binder tool surface

Alongside the workbook/worksheet/dashboard/field tools, four tools drive the fast-path
chart binder:

- **`list-templates`** — list the bundled chart templates with each one's chart-intent
  family, slot contract, and `fast_path_eligible` status. Works **headless** (no Desktop
  needed) — it reads the in-package snapshot.
- **`propose-template`** — Call 1: given a natural-language ask and the live workbook,
  return candidate templates + a strict `output_schema` for the caller to fill into a
  binding proposal (slot_id → field), or a deterministic no-LLM match when one is found.
- **`validate-proposal`** — Call 2 (dry run): run a filled proposal through the binder's
  deterministic gate (slot coverage, field/kind/role, derivation legality, confidence
  floor) and report valid/invalid **without** creating or applying a worksheet.
- **`bind-template`** — the full two-call flow: validate a filled proposal and, when valid,
  return the injector-ready args plus the apply instruction.

Typical flow: `propose-template` → fill the proposal → `validate-proposal` (dry run) →
`bind-template` to get the apply instruction.

## Build & run from source

Requires Node.js `>=22.7.5`.

```bash
npm ci
npm run build:desktop
```

The build emits the desktop entry point at **`build/index.desktop.js`** (the default
variant's `build/index.js` is not produced by this command). It also stages the bundled
authoring data under `build/desktop/data/` — this staging happens **only** for the desktop
and combined variants.

Point an MCP client at the entry over stdio:

```json
{
  "mcpServers": {
    "tableau-desktop": {
      "command": "node",
      "args": ["/absolute/path/to/tableau-mcp/build/index.desktop.js"]
    }
  }
}
```

## Requirements

- **`list-templates`** works headless against the bundled snapshot.
- **`propose-template`**, **`validate-proposal`**, and **`bind-template`** read/drive a
  **running Tableau Desktop** instance. Discover the instance with **`list-instances`** and
  pass its session id (the Tableau Desktop PID) as the `session` argument to those tools.

## Template content

- Templates ship as a **bundled snapshot** inside the package, hash-verified against a
  generated `content-manifest.json` (every resource carries a sha256 + byte count).
- **17** chart templates are bundled today.
- **`fast_path_eligible`** marks a template that is portable across the committed schema
  fixture **and** carries a live render-verification stamp — the templates the binder can
  one-shot. Ineligible templates report a `fast_path_blockers` entry explaining why (an
  explicit blocker code, or a derived note such as "no live render verification stamp").
- **Remote content packs** (fetching a signed, versioned pack instead of the bundled
  snapshot) are a **documented milestone-2 skeleton only** — the verification/cache/fallback
  contract exists behind the provider seam, but no transport is wired, so the server always
  serves the bundled snapshot. Its status honestly reports `satisfies_exec_freshness: false`.

## Known gaps

Stated honestly so nobody is surprised:

- The **search tools** (`search-examples`, `search-commands`, `search-workbook-examples`,
  `lookup-workbook-schema`) resolve their data **relative to the current working directory**,
  so they are effectively **dev-only** (run from a repo checkout) and are not reachable from
  a packaged install.
- The **publish pipeline does not yet build this variant** — the desktop authoring server is
  **from-source only** for now.
