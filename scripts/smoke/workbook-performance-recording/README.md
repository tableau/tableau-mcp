# Workbook performance recording smoke suite

This Windows-only suite validates the `0.2.14` workbook performance-recording routes through the
built Tableau MCP Desktop server and through Tableau Agent. It exercises three serialized scenarios
against a fresh Desktop process, workbook copy, MCP process, and chat:

1. `direct` calls `start-performance-recording`, forces workbook work with `get-summary-data` on
   `se-eval-scratch`, and calls `stop-performance-recording` over MCP stdio.
2. `agent-backend` prompts a directly launched `tab-agent-south` executable (or
   `uv run tab-agent-south`) over its WebSocket protocol and records every frame.
3. `agent-ui` opens the real `#live-dev` UI in headed Chrome and visibly submits the same prompt
   through the production composer and send controls.

## Do not run before approval

The suite launches and terminates Tableau Desktop, Tableau MCP, Tableau Agent, the UI development
server, and (for `agent-ui`) a headed Chrome process tree. It has intentionally not been run as part
of implementation. Run it only after the monolith and Tableau MCP builds/setup complete and the
operator explicitly approves the live smoke run.

## Prerequisites

- Windows PowerShell 7 or later.
- A built monolith containing External Client API `0.2.14` and a known `Tableau.exe` path.
- A built Tableau MCP Desktop entry (`build/index.desktop.js`) from package `2.68.7`, with this
  checkout's existing `node_modules` available. The harness does not install packages.
- `tab-agent-south` ready either as a supplied PyInstaller executable or through
  `uv run tab-agent-south`, including working LLM authentication.
- `tab-agent-south-ui` dependencies already installed; `yarn dev:live` must be runnable.
- Google Chrome for the visible UI scenario.
- The Desktop discovery directory and Desktop `log.txt` readable by the caller.
- No other live Tableau Desktop External Client API instance. The harness fails closed instead of
  accepting route evidence from a shared Desktop log when attribution would be ambiguous.
- All requested ports free. The existing `#live-dev` producer contract fixes the UI ports at 8081,
  51100, and 51101; the direct backend and CDP ports are independently configurable.

The default workbook is the existing `tab-agent-south/evals/stages/e1-revenue-by-region/anchor.twb`
with its adjacent CSV. Each scenario copies it to a task-owned staging directory under a new
workbook name. Supply `-WorkbookPath` and, when needed, one or more `-WorkbookDependencies` for
another workbook. Dependencies are copied beside the staged workbook with their original filenames.

## Offline contract tests

The offline contracts do not launch Tableau, South, Chrome, or the smoke entrypoint:

```powershell
npx vitest run --config .\scripts\smoke\workbook-performance-recording\vitest.config.mts
```

## Invocation (after explicit approval only)

Run all scenarios serially:

```powershell
pwsh -File .\scripts\smoke\workbook-performance-recording\Invoke-WorkbookPerformanceRecordingSmoke.ps1 `
  -Scenario all `
  -TableauExe 'D:\path\to\Tableau.exe'
```

Run one scenario:

```powershell
pwsh -File .\scripts\smoke\workbook-performance-recording\Invoke-WorkbookPerformanceRecordingSmoke.ps1 `
  -Scenario direct `
  -TableauExe 'D:\path\to\Tableau.exe' `
  -TableauMcpEntry 'D:\dev\tableau-mcp3\tableau-mcp\build\index.desktop.js'
```

Use a packaged agent executable:

```powershell
pwsh -File .\scripts\smoke\workbook-performance-recording\Invoke-WorkbookPerformanceRecordingSmoke.ps1 `
  -Scenario agent-backend `
  -TableauExe 'D:\path\to\Tableau.exe' `
  -TabAgentSouthExe 'D:\path\to\tab-agent-south.exe'
```

Important parameters include all repository and binary paths, the workbook and dependency paths,
discovery and Desktop log paths, output root, worksheet name, per-component ports, and bounded
startup/operation/turn timeouts. Use
`Get-Help .\scripts\smoke\workbook-performance-recording\Invoke-WorkbookPerformanceRecordingSmoke.ps1 -Full`
to inspect the PowerShell parameter surface.

## Evidence and verdicts

Every run creates `<OutputDirectory>/<UTC timestamp>-<nonce>/` and writes `provenance.json` before
launch. Each scenario owns a separate directory with:

- the staged workbook and dependencies;
- process stdout/stderr, launcher PID/start-time provenance, and scenario logs;
- MCP tool-call JSONL or backend WebSocket-frame JSONL;
- the raw/parsed CDP report plus `before.png`, `submitted.png`, and `completed.png` for the UI
  scenario;
- redacted Tableau MCP fileLogger output and only the Desktop `log.txt` bytes appended after that
  scenario began;
- the returned `.twbx` copied as `recorder-package.twbx` without deleting or modifying Desktop's
  original output;
- `scenario-summary.json`.

`provenance.json` records each repository's branch, HEAD, optional in-progress merge tip, base tip,
porcelain-status hash/count, feature-relative staged paths, staged/worktree diff hashes, and the
SHA-256/size of both `Tableau.exe` and the built Tableau MCP entry. This distinguishes an
uncommitted synchronized merge from its pre-merge HEAD and makes stale build attribution visible.

Success requires ordered start/stop tool evidence, a successful terminal agent turn where
applicable, both External Client API route paths in the scenario's Desktop log slice, correlated MCP
log timestamps, and an existing non-empty `.twbx` containing non-empty
`Data/Performance/perf_gantt.tab`. The summary records the package SHA-256. Operation IDs/states are
retained when a producer exposes them, but their absence is not treated as failure when they are not
observable.

The top-level `summary.json` aggregates all scenario and cleanup failures. The script returns
nonzero if any requested scenario fails, a required selector or log proof is absent, a package is
invalid, a process cannot be attributed, or a task-owned process/port survives cleanup.

Credential-shaped fields, quoted JSON secret keys, and bearer/token text are redacted before
persistence. Native South and MCP logs are written beneath a nonce-scoped raw directory outside the
preserved evidence tree; after process cleanup the harness writes sanitized combined evidence and
removes only that owned raw directory. Failure to remove it fails the suite. The harness never
writes discovery-file tokens to evidence. Cleanup validates PID start time before calling
`taskkill /PID <pid> /T /F`, touches only process trees launched or newly attributed by the
scenario, preserves all evidence, and never deletes the Desktop-generated recorder package.
