# Tableau Desktop Authoring MCP

The `@tableau/mcp-server` npm package is Web-only. This repository's **desktop** build variant
exposes a **local authoring** tool surface that drives a running **Tableau Desktop** instance —
inspect a workbook, list chart templates, and bind fields into worksheets — over MCP
(stdio).

Use the Desktop server from a source build or a standalone Desktop executable. This document
covers the source path. GitHub Release archives carry the Web executable only; build the Desktop
executable from source (`npm run build:sea:desktop`). Desktop builds are distributed separately.

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

## Workbook actions

`author-action` creates, edits, and deletes mark interactions. Omit `operation` to create. For
`operation: "edit"`, pass the exact `actionName` returned by creation and a complete replacement
definition: `mode`, `caption`, `sourceWorksheet`, the mode's target, and every nondefault option you
want to keep. Edits require an explicit `mode`; only creation defaults to `parameter`. Omitted
options use the creation defaults; edits do not merge individual settings. The internal action name
and enabled state stay the same, including when the mode changes. URL actions can share a destination
when their triggers, destination options, encoding, or source exclusions differ. For a dashboard-only
source, create with `sourceDashboard` and omit `sourceWorksheet`. An edit must still pass
`sourceWorksheet` (`""` for a dashboard-only source), because it replaces the full definition.

If edit readback reports that the original action was removed or changed, run `undo-workbook` in
the same session to restore the previous workbook before retrying. Failed verification does not
automatically undo the apply.

For example, this edits a URL action:

```json
{
  "operation": "edit",
  "actionName": "[Action1]",
  "mode": "url",
  "caption": "Open customer",
  "sourceWorksheet": "Customers",
  "url": "https://example.com/customer/<[Customer ID]>"
}
```

Delete with `{"operation":"delete","actionName":"[Action1]"}` and an optional `session`. An unknown
name returns the available names and captions. Existing actions can also be inspected with
`get-workbook-xml`; use their internal `name`, rather than their caption. Edits/deletes require a
Desktop build that replaces actions during whole-workbook applies. The tool verifies the resulting
action identities and edited settings after applying; `undo-workbook` and `redo-workbook` can
reverse and restore the change.

Highlight actions use `clearSelection: "show-all"` by default; Desktop always clears highlighting
with the selection. Other clearing options are refused before applying.

## Build & run from source

Requires Node.js `>=22.7.5`.

```bash
npm ci
npm run build:desktop
```

The build emits the desktop entry point at **`build/index.desktop.js`** (the default variant's
`build/index.js` is not produced by this command). It also stages the bundled authoring data under
`build/desktop/data/`. Desktop search and reference tools resolve those package-relative assets;
the standalone Desktop executable embeds the same assets. The Web npm package contains neither
the Desktop entry point nor the Desktop data.

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

For the environment variables this server reads, see the [Desktop section of the environment variable reference](https://tableau.github.io/tableau-mcp/docs/configuration/mcp-config/env-vars#desktop).

## Requirements

- **`list-templates`** works headless against the bundled snapshot.
- **`list-available-fields`**, **`build-worksheets-from-templates`**, **`apply-worksheet`**,
  and **`bind-template`** read/drive a **running Tableau Desktop** instance. Discover the
  instance with **`list-instances`** and pass its session id (the Tableau Desktop PID) as
  the `session` argument to those tools.

## Template content

- Templates ship as **TBM bookmark files** with the Desktop build
  (`src/desktop/data/templates/`, staged into the build). File names include descriptive
  `<family>__<chart>__<intent>.tbm` forms and shorter stable IDs such as
  `box-plot-chart.tbm`.
- Template slot contracts are **inferred from the TBM content** at load time; a rewritten
  bookmark re-infers on its changed bytes.
