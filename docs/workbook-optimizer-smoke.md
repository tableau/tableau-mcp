# Workbook Optimizer full-product smoke test

`npm run smoke:workbook-optimizer` is a deferred, receipts-backed smoke test for the Workbook
Optimizer Desktop tool. It covers three distinct client paths against the same open workbook:

1. A raw MCP client spawns the built `tableau-mcp` Desktop artifact, verifies that
   `run-workbook-optimizer` is advertised, and calls it.
2. A fresh `tab-agent-south` backend/executable receives a chat prompt over WebSocket and must
   choose `mcp__tableau-desktop__run-workbook-optimizer`.
3. The driver attaches to the Tableau WebEngine CDP endpoint, visibly types the prompt into the real
   Tableau Agent composer, clicks Send, and observes the UI's own WebSocket frames.

The command is intentionally inert unless `--run` is present. This makes it safe to check the
fixture, npm manifest, and built artifacts while a build or product setup is still in progress.

## Fixture and rule oracle

By default the harness uses monolith's existing product-test workbook:

```text
product-tests/data/server/workbooks/MttW/WorkbookOptimizer/WorkbookAnalyzerSuperstore.twbx
```

The workbook is expected to exercise several different metadata shapes:

- Rule 5: `FAIL`, with unused fields grouped by datasource.
- Rule 6: `NEEDS_REVIEW`, with more than ten visible sheets.
- Rule 20: `NEEDS_REVIEW`, with conditional filters nested by sheet and datasource.

Those three outcomes are the stable fixture oracle. The complete expected rule-ID set is read at
runtime from the installed `@tableau/workbook-analyzer-rules/src/native/rules-manifest.json`. A
smoke run therefore fails if generated C++ omits a package rule, returns an extra copied rule,
duplicates an ID, or changes one of the representative workbook outcomes.

## Prerequisites

- Build `tableau-mcp` so `build/index.desktop.js` exists.
- Build and set up the Tableau Agent bundle, or leave the `tab-agent-south` checkout and its
  `dist/tab-agent-south-<platform>` executable available. The source `uv run tab-agent-south`
  command is the fallback when no binary exists.
- Start the intended Tableau Desktop build with the fixture workbook open and the External Client
  API enabled.
- Launch Desktop's WebEngine with CDP enabled so the UI leg can attach:

  ```text
  --webEngineArgs --remote-debugging-port=9333 "--remote-allow-origins=*"
  ```

- Complete Tableau Agent authentication/setup. A fresh backend started by the harness uses the
  development authentication already configured for `tab-agent-south`.
- If more than one Desktop process is running, pass `--session <pid>`.

First perform the inert check:

```bash
npm run smoke:workbook-optimizer -- --session <desktop-pid>
```

After the build and product setup are ready, explicitly authorize the live run:

```bash
npm run smoke:workbook-optimizer -- --run --session <desktop-pid>
```

The default run executes all three scenarios serially. This is deliberate: one open workbook and one
agent turn are exercised at a time. To isolate a leg, repeat `--scenario` with one or more of
`direct`, `backend`, and `ui`.

To test an already-running backend instead of spawning an isolated one:

```bash
export MY_AGENT_WS_TOKEN='<token-if-required>'
npm run smoke:workbook-optimizer -- --run --session <desktop-pid> \
  --scenario backend --agent-ws-url ws://127.0.0.1:<port> \
  --agent-ws-token-env MY_AGENT_WS_TOKEN
```

The token is read from the named environment variable, is never printed in the run configuration,
and is not written to receipts.

## Evidence and pass criteria

Each run creates `smoke-results/workbook-optimizer/<timestamp>/` unless `--output-dir` is provided.
The final `summary.json` is written only after every requested leg passes; a failed live run writes
`failure.json` and preserves any earlier scenario receipts and logs.

- `direct-mcp/` contains the MCP response, its invocation log, and the byte-bounded Desktop log
  delta for `POST /v0/workbook:runWorkbookOptimizer`.
- `agent-backend/` always contains the full WebSocket event transcript and Desktop route log delta.
  When the harness starts an isolated backend (the default), it also captures the backend process
  log, ask-ledger record, and child `desktop-mcp-*.log`.
- `tableau-agent-ui/` contains CDP-captured WebSocket frames, new console errors, before and after
  screenshots, the parsed tool result, and the Desktop route log delta.

Every leg validates the typed `WorkbookOptimizerResult`, the npm-manifest rule set, the fixture
oracle, the exact optimizer tool name, a successful terminal result, and matching Desktop
request-received/request-completed log lines. The agent legs also reject a fallback to
`execute-tableau-command` with `get-workbook-analyzer-data`.

Run `npm run smoke:workbook-optimizer -- --help` for path and timeout overrides.
