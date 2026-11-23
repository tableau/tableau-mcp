---
sidebar_position: 1
---

# Desktop Authoring Server

The Desktop authoring server drives a running %product_name% instance over MCP (stdio). Use it to
inspect a workbook, list chart templates, and bind fields into worksheets.

Install it from npm as `@tableau/mcp-server-desktop`, or build it from source. The
`@tableau/mcp-server` npm package and the GitHub Release archives carry the Web server only.

## Prepare %product_name%

The server talks to %product_name% through its External Client API. To turn the API on and check
the version requirements, follow
[Use Tableau Studio Headless](ext://studio/use-tableau-studio-headless.html). Restart
%product_name% after you turn the API on.

## Install from npm

Requires [Node.js](https://nodejs.org/en/download) 22.7.5 or later and the External Client API
turned on (see above). Point your AI tool (MCP client) at the package:

```json
{
  "mcpServers": {
    "tableau-desktop": {
      "command": "npx",
      "args": ["-y", "@tableau/mcp-server-desktop@latest"],
      "env": {
        "TABLEAU_MCP_CACHE_DIR": "/absolute/path/to/a/cache/folder"
      }
    }
  }
}
```

Write `@latest` out. Without a version, `npx` can keep reusing the copy it downloaded first. Set
[`TABLEAU_MCP_CACHE_DIR`](../configuration/mcp-config/env-vars.md#tableau_mcp_cache_dir) to a full
path; otherwise the cache sits inside npm's own cache folder.

The package reads its settings from the environment only. It does not read a `.env` file.

The server can start before %product_name% does. Each tool checks the External Client API version
of the instance it calls, and tells you to update %product_name% if that instance is too old.

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

- `list-templates` and the cached-XML read, write, and validate tools work without
  %product_name%. They read bundled data or local files.
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
