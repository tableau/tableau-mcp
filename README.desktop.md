# Tableau Desktop Authoring MCP

The **desktop** build variant of `@tableau/mcp-server`. Where the default variant talks to
Tableau Cloud/Server over REST, this variant exposes a **local authoring** tool surface that
drives a running **Tableau Desktop** instance — inspect a workbook, list/inject chart
templates, and bind fields into worksheets — over MCP (stdio).

This document is a from-source quickstart. The desktop variant is **not** yet built by the
publish pipeline (see [Known gaps](#known-gaps)); build it from a clone.

## The template tool surface

Alongside the workbook/worksheet/dashboard/field tools, the primary chart-authoring flow
is caller-neutral and template-driven:

- **`list-templates`** — list the bundled chart templates (TBM bookmarks) with each one's
  chart-intent family and slot contract.
- **`list-available-fields`** — the live workbook's bindable fields, for filling slots.
- **`build-worksheets-from-templates`** — compile one or more chosen templates against
  chosen fields into built worksheet artifacts (they coexist until applied).
- **`apply-worksheet`** — apply a built artifact (or an edited cache file) to the live
  workbook; applies are sequential, and an artifact built against a Desktop instance that
  has since restarted is refused rather than replayed.

Typical flow: `list-templates` → `list-available-fields` →
`build-worksheets-from-templates` → `apply-worksheet`. `bind-template` remains for
proposal-driven binding of a single template when a caller wants the binder's
deterministic gate.

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
- **`list-available-fields`**, **`build-worksheets-from-templates`**, **`apply-worksheet`**,
  and **`bind-template`** read/drive a **running Tableau Desktop** instance. Discover the
  instance with **`list-instances`** and pass its session id (the Tableau Desktop PID) as
  the `session` argument to those tools.

## Template content

- Templates ship as **TBM bookmark files** bundled inside the package
  (`src/desktop/data/templates/`, staged into the build) — **133** templates today. File
  names include descriptive `<family>__<chart>__<intent>.tbm` forms and shorter stable IDs
  such as `box-plot-chart.tbm`.
- Template slot contracts are **inferred from the TBM content** at load time; a rewritten
  bookmark re-infers on its changed bytes.

## Known gaps

Stated honestly so nobody is surprised:

- The **search tools** (`search-examples`, `search-commands`, `search-workbook-examples`,
  `lookup-workbook-schema`) resolve their data **relative to the current working directory**,
  so they are effectively **dev-only** (run from a repo checkout) and are not reachable from
  a packaged install.
- The **publish pipeline does not yet build this variant** — the desktop authoring server is
  **from-source only** for now.
