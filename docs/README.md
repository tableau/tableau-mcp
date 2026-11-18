# Website

The Tableau MCP documentation website is built using [Docusaurus](https://docusaurus.io/), a modern
static website generator.

## Installation

```bash
npm install
```

## Local Development

```bash
npm run start
```

This command starts a local development server and opens up a browser window. Most changes are
reflected live without having to restart the server.

## Build

```bash
npm run build
```

This command generates static content into the `build` directory and can be served using any static
contents hosting service.

## Link Checking

To run a link checker locally, this is one way to do it using the Python [linkchecker](https://github.com/linkchecker/linkchecker) project:

```bash
npm install
npm run build
npm run serve
uvx linkchecker --check-extern --no-warnings http://localhost:3000/tableau-mcp/ --ignore-url="tableau.github.io" --ignore-url="127.0.0.1"
```

Note: We need to run `build` and `serve` here for this link checker to work properly. (It doesn't work
when just running `start`.)

## Keeping tool references current

Each web tool in `src/tools/web/tools.ts` needs a page under `docs/docs/web-tools/` and a row in
[Tool Access Requirements](docs/web-tools/overview.md). When changing role declarations,
registration conditions, or app-only visibility, update the access requirements on the tool page
and in the table. Run the registry check from the repository root:

```bash
npx vitest run src/tools/web/toolDocumentation.test.ts
```

This checks declared roles, conditions, app-only visibility, and top-level argument coverage,
including disabled tools; feature gates determine which appear in a session.
