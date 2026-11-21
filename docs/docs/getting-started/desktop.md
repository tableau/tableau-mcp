---
sidebar_position: 1
---

# Desktop Authoring Server

The `@tableau/mcp-server` npm package is Web-only. The **desktop** build of this repository runs a
local authoring server that drives a running %product_name% instance over MCP (stdio). Use it to
inspect a workbook, list chart templates, and bind fields into worksheets.

Run the Desktop server from a source build or from a standalone Desktop executable that you build
yourself. GitHub Release archives carry the Web executable only.

## Prepare %product_name%

The server talks to %product_name% through its External Client API. To turn the API on and check
the version requirements, follow
[Use Tableau Studio Headless](ext://studio/use-tableau-studio-headless.html). Restart
%product_name% after you turn the API on.

## Build and run from source

Requires [Node.js](https://nodejs.org/en/download) 22.7.5 or later.

```bash
npm ci
npm run build:desktop
```

The build writes the Desktop entry point to `build/index.desktop.js`. This command does not
produce the Web entry point `build/index.js`. It also stages the bundled authoring data under
`build/desktop/data/`, which the Desktop search and reference tools read.

Point your AI tool (MCP client) at the entry point over stdio:

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

For the environment variables this server reads, see the
[Desktop section of the environment variable reference](../configuration/mcp-config/env-vars.md#desktop).

## Build a standalone executable

To run the Desktop server without a Node.js install, build it as a
[Node.js Single Executable Application](../extras/node-sea.md):

```bash
npm run build:sea:desktop
```

The executable, `tableau-mcp-desktop` (`tableau-mcp-desktop.exe` on Windows), is written to
`build/sea/desktop/<platform>/`. It embeds the same authoring data as the source build.

## Requirements

- `list-templates`, the expertise tools, and the cached-XML read, write, and validate tools work
  without %product_name%. They read bundled data or local files.
- `list-available-fields`, `build-worksheets-from-templates`, `apply-worksheet`, `bind-template`,
  and the other tools that call the External Client API need a **running %product_name%**
  instance.
- The server finds running instances through the discovery files each instance writes to
  `<root>/Tableau/Tableau/ExternalApi/<pid>.json`. See
  [`TABLEAU_EXTERNAL_API_DISCOVERY_DIR`](../configuration/mcp-config/env-vars.md#tableau_external_api_discovery_dir)
  for the root on each platform.
- With more than one instance open, call [`list-instances`](../desktop-tools/session/list-instances.md)
  and pass the returned session id (the instance's process id, for example `"12345"`) as the
  `session` argument. With exactly one instance open, you can omit `session`.

## Build a chart from a template

The template flow builds worksheets from the bundled chart templates:

1. [`list-templates`](../desktop-tools/binder/list-templates.md): list the chart templates, each
   with its chart family and the slots it needs.
2. [`list-available-fields`](../desktop-tools/fields/list-available-fields.md): list the live
   workbook's fields that can fill those slots.
3. [`build-worksheets-from-templates`](../desktop-tools/template/build-worksheets-from-templates.md):
   bind chosen templates to chosen fields. Each built worksheet is an artifact; several can
   coexist until you apply them.
4. [`apply-worksheet`](../desktop-tools/worksheet/apply-worksheet.md): apply one built artifact to
   the live workbook. Apply artifacts one at a time. An artifact built against an instance that
   has since restarted is refused, not replayed.

To bind a single template from a plain-language ask, use
[`bind-template`](../desktop-tools/binder/bind-template.md) instead.
